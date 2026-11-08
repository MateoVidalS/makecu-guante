#!/usr/bin/env python3
"""Bench hardware-in-the-loop test for the memo glove firmware.

Runs every command and safety path that can be exercised on the bench without
tendons, a STOP button or a NeoPixel ring, against the real board over serial,
and prints PASS/FAIL per check (Spanish labels). Results and a log are written
next to the output path. Not part of the PlatformIO build.

BENCH ONLY: no glove on anyone, no tendons. It moves all five servos, resets the
board through RTS, and temporarily sets `limit` to 100 mA (overcurrent check)
and 750 mA (run-mode checks, for a ~0.8 A MB102 supply), then restores 1500 mA.
Close any serial monitor first: the script needs the port to itself.

Usage (pyserial ships with PlatformIO's Python):
    python hil_test.py COM3 results.json            # all sections, ~3 minutes
    python hil_test.py COM3 results.json B          # only some sections (A-G)
Sections: A boot/telemetry, B protocol/validation (no motion), C jog per finger,
D watchdog, E overcurrent, F calibration, G target/follow.
Last full run: 84/84 PASS on main @ 091b447 (see hardware/BANCO.md).
"""
import json
import statistics
import sys
import threading
import time

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM3"
OUT = sys.argv[2] if len(sys.argv) > 2 else "hil_results.json"
LOG = OUT.rsplit(".", 1)[0] + ".log"
NAMES = ["pulgar", "indice", "medio", "anular", "menique"]
# Bench-only ranges (never a patient's): slack = min. Middle and pinky mirrored.
RANGES = [(60, 120), (60, 120), (120, 60), (60, 120), (120, 60)]

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def now():
    # perf_counter: time.monotonic() only advances every ~15.6 ms on Windows.
    return time.perf_counter()


class Board:
    def __init__(self, port, log_path):
        self.s = serial.Serial()
        self.s.port, self.s.baudrate, self.s.timeout = port, 115200, 0.02
        self.s.dtr = False
        self.s.rts = False
        self.s.open()
        self.rl, self.wl = threading.Lock(), threading.Lock()
        self.msgs, self.tel = [], []
        self.keep, self.last_ping, self.alive = False, 0.0, True
        self.t0 = now()
        self.logf = open(log_path, "w", encoding="utf-8")
        threading.Thread(target=self._rx, daemon=True).start()
        threading.Thread(target=self._ka, daemon=True).start()

    def log(self, text):
        self.logf.write(f"{now() - self.t0:8.3f} {text}\n")
        self.logf.flush()

    def _rx(self):
        buf = b""
        while self.alive:
            try:
                data = self.s.read(256)
            except Exception as exc:  # USB unplugged, etc.
                self.log(f"RX ERROR {exc}")
                time.sleep(0.2)
                continue
            if not data:
                continue
            buf += data
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                t = now()
                txt = raw.decode("utf-8", "replace").replace("\x00", "").strip()
                if not txt:
                    continue
                try:
                    obj = json.loads(txt)
                except Exception:
                    obj = None
                is_tel = isinstance(obj, dict) and obj.get("t") == "tel"
                with self.rl:
                    if is_tel:
                        self.tel.append((t, obj, len(raw.rstrip(b"\r"))))
                    else:
                        self.msgs.append((t, obj, txt))
                if is_tel:
                    if len(self.tel) % 10 == 0:
                        self.log(f"tel {txt}")
                else:
                    self.log(f"< {txt}")

    def _ka(self):
        while self.alive:
            if self.keep:
                self.write({"t": "ping"}, quiet=True)
                self.last_ping = now()
            time.sleep(0.25)

    def write(self, line, quiet=False):
        if isinstance(line, dict):
            line = json.dumps(line, separators=(",", ":"))
        data = line if isinstance(line, bytes) else (line + "\n").encode()
        with self.wl:
            t = now()  # stamp before sending: a reply can never look older than its command
            self.s.write(data)
            self.s.flush()
        if not quiet:
            self.log(f"> {data!r}")
        return t

    def reset(self):
        self.s.dtr = False
        self.s.rts = True
        time.sleep(0.15)
        self.s.rts = False
        return now()

    def find(self, pred, since):
        with self.rl:
            for m in self.msgs:
                if m[0] >= since and pred(m[1]):
                    return m
        return None

    def wait(self, pred, since, timeout):
        end = now() + timeout
        while now() < end:
            m = self.find(pred, since)
            if m:
                return m
            time.sleep(0.01)
        return None

    def tels(self, since, until=None):
        with self.rl:
            return [x for x in self.tel if x[0] >= since and (until is None or x[0] <= until)]

    def last(self):
        with self.rl:
            return self.tel[-1][1] if self.tel else {}

    def wait_tel(self, pred, since, timeout):
        end = now() + timeout
        while now() < end:
            for t, o, _ in self.tels(since):
                if pred(o):
                    return t, o
            time.sleep(0.01)
        return None


def is_err(o):
    return isinstance(o, dict) and o.get("t") == "err"


def is_info(o):
    return isinstance(o, dict) and o.get("t") == "info"


def is_evt(name):
    return lambda o: isinstance(o, dict) and o.get("t") == "evt" and o.get("e") == name


RESULTS = []


def rec(section, name, status, detail=""):
    RESULTS.append({"section": section, "test": name, "status": status, "detail": detail})
    print(f"[{status:4}] {section} | {name} | {detail}", flush=True)


def ok(section, name, cond, detail=""):
    rec(section, name, "PASS" if cond else "FAIL", detail)
    return cond


def expect_err(b, sec, name, line, why, timeout=0.6):
    whys = why if isinstance(why, (list, tuple)) else [why]
    time.sleep(0.08)  # let earlier replies arrive first
    t0 = b.write(line)
    m = b.wait(is_err, t0, timeout)
    got = m[1].get("why") if m else None
    ok(sec, name, got in whys, f"esperado {'/'.join(whys)}, llego {got or 'nada'}")
    return got


def expect_no_err(b, sec, name, line, timeout=0.5):
    time.sleep(0.08)
    t0 = b.write(line)
    m = b.wait(is_err, t0, timeout)
    ok(sec, name, m is None, "aceptado" if m is None else f"llego {m[2]}")
    return t0


def hello(b, timeout=1.0):
    t0 = b.write({"t": "hello"})
    m = b.wait(is_info, t0, timeout)
    return m[1] if m else None


def wait_state(b, st, timeout=2.0):
    return b.wait_tel(lambda o: o.get("st") == st, now(), timeout) is not None


def ma_stats(b, t0, t1):
    v = [o["ma"] for _, o, _ in b.tels(t0, t1)]
    if not v:
        return 0, 0, 0
    return min(v), statistics.median(v), max(v)


def reach(b, t0, i, goal, timeout, tol=0.015):
    r = b.wait_tel(lambda o: abs(o["a"][i] - goal) <= tol, t0, timeout)
    return (r[0] - t0) if r else None


def fmt_s(x):
    return f"{x:.2f} s" if x is not None else "no"


def section_boot(b):
    S = "A. Arranque y telemetria"
    t0 = b.reset()
    info = b.wait(is_info, t0, 4)
    time.sleep(1.0)
    boot = b.find(is_evt("boot"), t0)
    ina = b.find(is_evt("ina_missing"), t0)
    ok(S, "evento boot con motivo de reinicio", boot is not None and "reset_reason" in boot[1],
       boot[2] if boot else "no llego")
    i = info[1] if info else {}
    ok(S, "info: 5 dedos, limite 1500 mA, sin calibracion",
       i.get("fingers") == 5 and i.get("limit") == 1500 and i.get("calib") == [None] * 5,
       info[2] if info else "no llego")
    ok(S, "encuentra el INA219 (no avisa ina_missing)", ina is None, "ok" if ina is None else ina[2])
    t1 = now()
    time.sleep(2.0)
    tl = b.tels(t1, t1 + 2.0)
    rate = len(tl) / 2.0
    ok(S, "telemetria a ~50 Hz", 45 <= rate <= 55, f"{rate:.1f} lineas/s")
    fields = len(tl) > 0 and all(
        {"ms", "a", "ma", "st", "md", "tg"} <= set(o) and len(o["a"]) == 5 and len(o["tg"]) == 5
        for _, o, _ in tl)
    ok(S, "telemetria: todos los campos y 5 valores por dedo", fields)
    mx = max((n for *_, n in tl), default=0)
    ok(S, "telemetria: cada linea <= 200 bytes", 0 < mx <= 200, f"maximo {mx} bytes")
    ms = [o["ms"] for _, o, _ in tl]
    ok(S, "telemetria: el reloj de la placa siempre crece", all(y > x for x, y in zip(ms, ms[1:])))
    lo, _, hi = ma_stats(b, t1, t1 + 2)
    st = sorted({o["st"] for _, o, _ in tl})
    md = sorted({o["md"] for _, o, _ in tl})
    ok(S, "reposo: idle, sin modo, corriente baja", st == ["idle"] and md == ["none"] and hi < 60,
       f"st={st} md={md} corriente {lo}-{hi} mA")
    return t0


def section_protocol(b):
    S = "B. Comandos y validacion"
    ok(S, "hello responde info", hello(b) is not None)
    t0 = b.write('{"t":"hello","extra":123}')
    ok(S, "ignora campos desconocidos", b.wait(is_info, t0, 1) is not None)
    t0 = b.write(b'{"t":"hello"}\r\n')
    ok(S, "acepta fin de linea CRLF", b.wait(is_info, t0, 1) is not None)
    expect_err(b, S, "JSON cortado '{' -> bad_json", "{", "bad_json")
    expect_err(b, S, "JSON que no es objeto '[]' -> bad_json", "[]", "bad_json")
    expect_err(b, S, "tipo desconocido -> unknown_type", '{"t":"unknown"}', "unknown_type")
    expect_err(b, S, "9 niveles de anidado -> bad_json", '{"t":"hello","x":[[[[[[[[[1]]]]]]]]]}', "bad_json")
    expect_err(b, S, "numero no finito (NaN) -> rechazado", '{"t":"jog","i":1,"deg":NaN}',
               ["bad_json", "bad_args"])
    t0 = b.write('{"t":"hello","pad":"' + "x" * 240 + '"}')
    time.sleep(0.6)
    m_err, m_info = b.find(is_err, t0), b.find(is_info, t0)
    alive = hello(b) is not None
    ok(S, "linea de mas de 200 bytes: no se ejecuta y la placa sigue respondiendo",
       m_info is None and alive, f"respuesta: {m_err[2] if m_err else 'ninguna'}")
    expect_err(b, S, "jog dedo 5 (no existe) -> bad_args", '{"t":"jog","i":5,"deg":90}', "bad_args")
    expect_err(b, S, "jog a 180 grados -> bad_args", '{"t":"jog","i":1,"deg":180}', "bad_args")
    expect_err(b, S, "jog a 176 grados -> bad_args", '{"t":"jog","i":1,"deg":176}', "bad_args")
    expect_err(b, S, "jog a 4 grados -> bad_args", '{"t":"jog","i":1,"deg":4}', "bad_args")
    expect_err(b, S, "target con 2 valores -> bad_args", '{"t":"target","f":[1,1],"v":0.5}', "bad_args")
    expect_err(b, S, "target con 3 valores -> bad_args", '{"t":"target","f":[1,1,1],"v":0.5}', "bad_args")
    expect_err(b, S, "target con texto -> bad_args", '{"t":"target","f":[1,"x",0,0.3,0.2],"v":0.5}',
               "bad_args")
    expect_err(b, S, "target con velocidad 0 -> bad_args", '{"t":"target","f":[1,1,1,0.3,0.2],"v":0}',
               "bad_args")
    expect_err(b, S, "calib dedo 5 -> bad_args", '{"t":"calib","i":5,"min":20,"max":150}', "bad_args")
    expect_err(b, S, "calib con menos de 20 grados -> bad_args", '{"t":"calib","i":1,"min":20,"max":25}',
               "bad_args")
    expect_err(b, S, "limit con texto -> bad_args", '{"t":"limit","ma":"x"}', "bad_args")
    expect_err(b, S, "target sin calibrar -> no_calib", '{"t":"target","f":[0.2,0.2,0.2,0.2,0.2],"v":0.5}',
               "no_calib")
    expect_err(b, S, "follow sin calibrar -> no_calib", '{"t":"follow","f":[0.2,0.2,0.2,0.2,0.2]}',
               "no_calib")
    for sent, want in [(900, 900), (50, 100), (5000, 2200), (1500, 1500)]:
        b.write({"t": "limit", "ma": sent})
        time.sleep(0.15)
        i = hello(b)
        got = i.get("limit") if i else None
        ok(S, f"limit {sent} -> queda en {want}", got == want, f"info.limit = {got}")
    st = b.last().get("st")
    ok(S, "ningun comando invalido movio nada (sigue en idle)", st == "idle", f"st={st}")


def section_jog(b):
    S = "C. Motores (jog, de a uno)"
    per = {}
    b.keep = True
    time.sleep(0.3)
    for i, n in enumerate(NAMES):
        ti = now()
        time.sleep(0.4)
        _, idle_med, _ = ma_stats(b, ti, now())
        t0 = b.write({"t": "jog", "i": i, "deg": 60})
        time.sleep(0.9)
        b.write({"t": "jog", "i": i, "deg": 120})
        time.sleep(1.4)
        b.write({"t": "jog", "i": i, "deg": 90})
        time.sleep(0.9)
        t1 = now()
        modes = {(o["st"], o["md"]) for _, o, _ in b.tels(t0, t1)}
        _, med, hi = ma_stats(b, t0, t1)
        b.write({"t": "release"})
        idle_ok = wait_state(b, "idle", 2.0)
        time.sleep(0.5)
        _, after, _ = ma_stats(b, now() - 0.3, now())
        e = b.find(is_err, t0)
        ok(S, f"{n} (dedo {i}): se mueve 60-120 grados y vuelve a reposo",
           e is None and hi - idle_med > 40 and ("calib", "jog") in modes and idle_ok and after < idle_med + 30,
           f"quieto {idle_med:.0f} mA, moviendose hasta {hi:.0f} mA (mediana {med:.0f}), despues {after:.0f} mA"
           + (f", error {e[2]}" if e else ""))
        per[n] = {"quieto_mA": idle_med, "pico_mA": hi, "mediana_mA": med}
    expect_no_err(b, S, "jog a 5 grados (limite) se acepta", '{"t":"jog","i":1,"deg":5}', 0.25)
    b.write({"t": "jog", "i": 1, "deg": 90})
    time.sleep(0.6)
    expect_no_err(b, S, "jog a 175 grados (limite) se acepta", '{"t":"jog","i":1,"deg":175}', 0.25)
    b.write({"t": "jog", "i": 1, "deg": 90})
    time.sleep(0.8)
    b.write({"t": "release"})
    b.keep = False
    wait_state(b, "idle", 2.0)
    return per


def section_watchdog(b):
    S = "D. Watchdog"
    t0 = now()
    time.sleep(2.5)
    ok(S, "en reposo no salta (2,5 s sin mensajes)", b.find(is_evt("watchdog"), t0) is None)
    b.keep = True
    time.sleep(0.3)
    b.write({"t": "jog", "i": 1, "deg": 70})
    time.sleep(0.8)
    b.keep = False
    time.sleep(0.05)
    t_last = b.last_ping
    m = b.wait(is_evt("watchdog"), t_last, 2.5)
    dt = (m[0] - t_last) if m else None
    ok(S, "motor activo y sin mensajes: salta a ~1 s", m is not None and 0.95 <= dt <= 1.35,
       f"salto a los {fmt_s(dt)} del ultimo ping")
    ok(S, "queda trabado en fault", wait_state(b, "fault", 0.5))
    expect_err(b, S, "en fault, jog -> rechazado", '{"t":"jog","i":1,"deg":90}', ["fault", "state"])
    b.write({"t": "release"})
    ok(S, "release destraba (idle)", wait_state(b, "idle", 2.0))


def section_overcurrent(b):
    S = "E. Corte por sobrecorriente"
    b.write({"t": "limit", "ma": 100})
    time.sleep(0.2)
    i = hello(b)
    ok(S, "limite bajado a 100 mA", bool(i) and i.get("limit") == 100)
    b.keep = True
    time.sleep(0.3)
    t0 = b.write({"t": "jog", "i": 2, "deg": 150})
    m = b.wait(is_evt("overcurrent"), t0, 2.5)
    b.keep = False
    ok(S, "moviendo el medio con limite 100 mA, corta", m is not None,
       f"corto a los {m[0] - t0:.2f} s, pico informado {m[1].get('ma')} mA" if m else "no corto")
    ok(S, "queda en fault", wait_state(b, "fault", 0.5))
    time.sleep(0.6)
    _, after, _ = ma_stats(b, now() - 0.3, now())
    ok(S, "despues del corte la corriente baja", after < 60, f"{after:.0f} mA")
    b.write({"t": "release"})
    idle = wait_state(b, "idle", 2.0)
    b.write({"t": "limit", "ma": 1500})
    time.sleep(0.2)
    i = hello(b)
    ok(S, "release destraba y el limite vuelve a 1500 mA", idle and bool(i) and i.get("limit") == 1500)


def same_ranges(got, want):
    try:
        return all(g is not None and abs(g[0] - w[0]) < 0.6 and abs(g[1] - w[1]) < 0.6 for g, w in zip(got, want))
    except Exception:
        return False


def section_calib(b):
    S = "F. Calibracion"
    b.keep = True
    time.sleep(0.3)
    for i, (mn, _) in enumerate(RANGES):  # park each servo at its slack angle first
        b.write({"t": "jog", "i": i, "deg": mn})
        time.sleep(0.9)
        if i == 0:
            expect_err(b, S, "calib mientras hay un jog activo -> state",
                       '{"t":"calib","i":0,"min":60,"max":120}', "state")
    b.write({"t": "release"})
    b.keep = False
    ok(S, "release despues de posicionar (idle)", wait_state(b, "idle", 2.0))
    b.write({"t": "calib", "i": 1, "min": 60, "max": 120})
    time.sleep(0.15)
    i1 = hello(b)
    had = bool(i1) and i1["calib"][1] is not None
    expect_err(b, S, "calib invalido (10 grados) -> bad_args", '{"t":"calib","i":1,"min":60,"max":70}', "bad_args")
    i2 = hello(b)
    gone = bool(i2) and i2["calib"][1] is None
    ok(S, "un calib invalido borra el rango de ese dedo", had and gone,
       f"antes {i1['calib'][1] if i1 else '?'}, despues {i2['calib'][1] if i2 else '?'}")
    t0 = now()
    for i, (mn, mx) in enumerate(RANGES):
        b.write({"t": "calib", "i": i, "min": mn, "max": mx})
        time.sleep(0.12)
    m = b.wait(is_evt("calib_ok"), t0, 1.0)
    e = b.find(is_err, t0)
    ok(S, "5 rangos validos -> calib_ok", m is not None and e is None, e[2] if e else "")
    i3 = hello(b)
    ok(S, "info muestra los 5 rangos (medio y menique espejados)", bool(i3) and same_ranges(i3["calib"], RANGES),
       json.dumps(i3["calib"]) if i3 else "")


def section_run(b):
    S = "G. Modo ejercicio (target / follow)"
    b.write({"t": "limit", "ma": 750})  # the MB102 module gives ~0.8 A
    time.sleep(0.15)
    b.keep = True
    time.sleep(0.3)
    lat = []
    for i, n in enumerate(NAMES):
        f = [0] * 5
        f[i] = 0.6
        t0 = b.write({"t": "target", "f": f, "v": 0.5})
        r = b.wait_tel(lambda o: abs(o["tg"][i] - 0.6) <= 0.011, t0, 0.5)
        if r:
            lat.append(r[0] - t0)
        dt = reach(b, t0, i, 0.6, 2.5)
        t1 = now()
        tl = b.tels(t0, t1)
        modes = {(o["st"], o["md"]) for _, o, _ in tl}
        others = max((max(abs(o["a"][k]) for k in range(5) if k != i) for _, o, _ in tl), default=0)
        _, _, hi = ma_stats(b, t0, t1)
        e = b.find(is_err, t0)
        ok(S, f"{n}: target 0,6 a 0,5 rango/s llega en ~1,2 s",
           e is None and dt is not None and 0.9 <= dt <= 1.6 and ("run", "target") in modes and others <= 0.01,
           f"llego en {fmt_s(dt)}, pico {hi:.0f} mA, otros dedos {others:.2f}" + (f", {e[2]}" if e else ""))
        t2 = b.write({"t": "target", "f": [0] * 5, "v": 0.5})
        du = reach(b, t2, i, 0.0, 1.0, 0.005)
        ok(S, f"{n}: al bajar el objetivo afloja rapido (3 rangos/s)", du is not None and du <= 0.45,
           f"aflojo en {fmt_s(du)}")
        time.sleep(0.3)
    if lat:
        rec(S, "demora comando -> telemetria", "INFO",
            f"mediana {statistics.median(lat) * 1000:.0f} ms, max {max(lat) * 1000:.0f} ms ({len(lat)} medidas)")
    t0 = b.write({"t": "target", "f": [0.6, 0, 0, 0, 0], "v": 5})
    e = b.wait(is_err, t0, 0.3)
    if e:
        rec(S, "velocidad pedida 5 -> se limita a 1 rango/s", "FAIL", f"rechazado: {e[2]}")
    else:
        dt = reach(b, t0, 0, 0.6, 2.0)
        ok(S, "velocidad pedida 5 -> se limita a 1 rango/s (0,6 en ~0,6 s)",
           dt is not None and 0.45 <= dt <= 0.9, f"llego en {fmt_s(dt)}")
    b.write({"t": "target", "f": [0] * 5, "v": 0.5})
    time.sleep(0.5)
    t0 = b.write({"t": "follow", "f": [0, 0.6, 0, 0, 0]})
    r = b.wait_tel(lambda o: o["md"] == "follow", t0, 0.5)
    tg = r[1]["tg"][1] if r else None
    ok(S, "follow reemplaza a target con 8% de margen (0,6 -> 0,52)",
       tg is not None and abs(tg - 0.52) <= 0.011, f"tg = {tg}")
    dt = reach(b, t0, 1, 0.52, 1.5)
    ok(S, "follow llega a 0,52 a 1,5 rangos/s (~0,35 s)", dt is not None and 0.2 <= dt <= 0.6, f"llego en {fmt_s(dt)}")
    t2 = b.write({"t": "follow", "f": [0] * 5})
    du = reach(b, t2, 1, 0.0, 1.0, 0.005)
    ok(S, "follow a 0 afloja rapido", du is not None and du <= 0.45, f"aflojo en {fmt_s(du)}")
    expect_err(b, S, "jog en modo ejercicio -> state", '{"t":"jog","i":0,"deg":90}', "state")
    expect_err(b, S, "calib en modo ejercicio -> state", '{"t":"calib","i":0,"min":60,"max":120}', "state")
    t0 = b.write({"t": "target", "f": [0, 0, 0.6, 0, 0], "v": 0.5})
    reach(b, t0, 2, 0.6, 2.5)
    t1 = b.write({"t": "release"})
    du = reach(b, t1, 2, 0.0, 1.0, 0.005)
    idle = b.wait_tel(lambda o: o["st"] == "idle", t1, 2.0)
    ok(S, "release en ejercicio: afloja y vuelve a idle", du is not None and du <= 0.45 and idle is not None,
       f"aflojo en {fmt_s(du)}, idle a los {fmt_s(idle[0] - t1 if idle else None)}")
    t0 = b.write({"t": "target", "f": [0, 0, 0, 0.5, 0], "v": 0.5})
    reach(b, t0, 3, 0.5, 2.5)
    b.keep = False
    time.sleep(0.05)
    t_last = b.last_ping
    m = b.wait(is_evt("watchdog"), t_last, 2.5)
    du = reach(b, m[0], 3, 0.0, 1.0, 0.005) if m else None
    ok(S, "watchdog en ejercicio: salta a ~1 s y afloja el dedo",
       m is not None and 0.95 <= m[0] - t_last <= 1.35 and du is not None,
       f"salto a los {fmt_s(m[0] - t_last if m else None)}, aflojo en {fmt_s(du)}")
    ok(S, "queda en fault", wait_state(b, "fault", 0.5))
    expect_err(b, S, "en fault, target -> rechazado", '{"t":"target","f":[0.2,0,0,0,0],"v":0.5}',
               ["fault", "state"])
    b.write({"t": "release"})
    ok(S, "release destraba", wait_state(b, "idle", 2.0))
    b.keep = True
    time.sleep(0.3)
    f = [0] * 5
    t0 = now()
    for i in range(5):
        f[i] = 0.3
        b.write({"t": "target", "f": f, "v": 0.3})
        time.sleep(0.3)
    all_in = b.wait_tel(lambda o: all(abs(x - 0.3) <= 0.015 for x in o["a"]), t0, 3.0)
    _, _, hi = ma_stats(b, t0, now())
    oc = b.find(is_evt("overcurrent"), t0)
    ok(S, "los 5 dedos juntos (escalonados) llegan a 0,3 sin sobrecorriente", all_in is not None and oc is None,
       f"pico total {hi:.0f} mA" + (f", {oc[2]}" if oc else ""))
    time.sleep(0.5)
    for i in range(5):
        f[i] = 0
        b.write({"t": "target", "f": f, "v": 0.3})
        time.sleep(0.3)
    time.sleep(0.3)
    b.write({"t": "release"})
    ok(S, "release final -> idle", wait_state(b, "idle", 2.5))
    b.keep = False
    b.write({"t": "limit", "ma": 1500})
    time.sleep(0.15)


def main():
    b = Board(PORT, LOG)
    per = {}
    t_boot = now()
    try:
        b.write({"t": "release"})
        time.sleep(0.3)
        only = sys.argv[3].upper() if len(sys.argv) > 3 else "ABCDEFG"
        if "A" in only:
            t_boot = section_boot(b)
        if "B" in only:
            section_protocol(b)
        if "C" in only:
            per = section_jog(b)
        if "D" in only:
            section_watchdog(b)
        if "E" in only:
            section_overcurrent(b)
        if "F" in only:
            section_calib(b)
        if "G" in only:
            section_run(b)
    except Exception as exc:
        rec("Z", "el programa de prueba se corto", "FAIL", repr(exc))
    finally:
        b.keep = False
        b.write({"t": "release"})
        b.write({"t": "limit", "ma": 1500})
        time.sleep(0.6)
        S = "H. Final"
        boots = [m for m in b.msgs if m[0] > t_boot + 2 and is_evt("boot")(m[1])]
        ok(S, "la placa no se reinicio sola durante la prueba", not boots, f"{len(boots)} reinicios")
        stops = [m for m in b.msgs if is_evt("stop_button")(m[1])]
        if stops:
            rec(S, "avisos de STOP durante la prueba", "INFO", f"{len(stops)} (no hay boton conectado)")
        inam = [m for m in b.msgs if m[0] > t_boot + 2 and is_evt("ina_missing")(m[1])]
        ok(S, "el INA219 no se perdio durante la prueba", not inam, f"{len(inam)} avisos")
        last = b.last()
        ok(S, "termina en idle con corriente baja", last.get("st") == "idle" and last.get("ma", 999) < 60,
           f"st={last.get('st')} ma={last.get('ma')}")
        for name, why in [
            ("boton STOP", "no esta conectado"),
            ("arranque sin INA219 (ina_missing + target/follow rechazados)", "hay que desconectar el INA219"),
            ("brown-out y USB desconectado en movimiento", "necesita una fuente controlada"),
            ("anillo de LEDs", "no esta conectado"),
            ("servo trabado a mano (BENCH 7)", "necesita tendones y una persona"),
            ("pulsos en GPIO4/GPIO13 al arrancar (BENCH 3)", "necesita osciloscopio"),
        ]:
            rec("I. No probado en este banco", name, "SKIP", why)
        b.alive = False
        summary = {s: sum(1 for r in RESULTS if r["status"] == s) for s in ("PASS", "FAIL", "INFO", "SKIP")}
        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump({"summary": summary, "servos": per, "results": RESULTS}, fh, ensure_ascii=False, indent=2)
        print("RESUMEN", json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
