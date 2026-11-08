"""Bench monitor for the memo glove ESP32 (BENCH ONLY: no hand, no glove on anyone).

Owns the serial port (opened without resetting the board), pings every 300 ms, and logs
every non-telemetry line (info/evt/err), a telemetry summary every 5 s and warnings (high
idle current) to <dir>/bench.log. Exits on its own if the USB is unplugged.

Commands are JSON lines appended to <dir>/cmd.jsonl. Raw firmware lines are forwarded as-is;
macros: __test_finger, __scan, __burnin, __sweep, __quit (see hardware/BENCH-3.md).

Usage (pyserial via uv):
    uv run --no-project --with pyserial python bench_monitor.py COM3 <dir>
"""

import collections
import json
import os
import statistics
import sys
import threading
import time

import serial

PORT, DIR = sys.argv[1], sys.argv[2]
LOG = os.path.join(DIR, "bench.log")
CMD = os.path.join(DIR, "cmd.jsonl")
NAMES = ["pulgar", "indice", "medio", "anular", "menique"]

logf = open(LOG, "a", encoding="utf-8")
t0 = time.perf_counter()
lock = threading.Lock()
tel = collections.deque(maxlen=3000)  # (t, obj)
events = collections.deque(maxlen=500)  # (t, obj or text)
alive = True


def now():
    return time.perf_counter() - t0


def log(text):
    stamp = time.strftime("%H:%M:%S")
    logf.write(f"{stamp} {text}\n")
    logf.flush()
    print(f"{stamp} {text}", flush=True)


s = serial.Serial()
s.port, s.baudrate, s.timeout = PORT, 115200, 0.02
s.dtr = False  # do not reset the board on open
s.rts = False
s.open()
wlock = threading.Lock()


def send(obj, quiet=False):
    line = obj if isinstance(obj, str) else json.dumps(obj, separators=(",", ":"))
    with wlock:
        s.write((line + "\n").encode())
        s.flush()
    if not quiet:
        log(f"> {line}")


def rx():
    buf = b""
    while alive:
        try:
            data = s.read(512)
        except Exception as exc:
            log(f"ERROR serial read: {exc}")
            time.sleep(0.5)
            continue
        if not data:
            continue
        buf += data
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            txt = raw.decode("utf-8", "replace").replace("\x00", "").strip()
            if not txt:
                continue
            try:
                obj = json.loads(txt)
            except Exception:
                obj = None
            t = now()
            if isinstance(obj, dict) and obj.get("t") == "tel":
                with lock:
                    tel.append((t, obj))
                continue
            with lock:
                events.append((t, obj if obj is not None else txt))
            kind = obj.get("t") if isinstance(obj, dict) else "raw"
            label = {"evt": "EVT", "err": "ERR", "info": "INFO"}.get(kind, "RAW")
            log(f"{label} {txt}")


def keepalive():
    global alive
    failures = 0
    while alive:
        try:
            send({"t": "ping"}, quiet=True)
            failures = 0
        except Exception as exc:
            failures += 1
            if failures == 1:
                log(f"ERROR serial write: {exc}")
            if failures >= 5:
                log("ERROR port lost (USB unplugged?); monitor exits, restart it after replugging")
                alive = False
        time.sleep(0.3)


def window(since, until=None):
    with lock:
        return [o for (t, o) in tel if t >= since and (until is None or t <= until)]


def summary():
    high_since = None
    while alive:
        time.sleep(5)
        recent = window(now() - 5)
        if not recent:
            log("WARN no telemetry in the last 5 s")
            continue
        ma = [o.get("ma", 0) for o in recent]
        last = recent[-1]
        log(
            f"TEL st={last.get('st')} md={last.get('md')} ma_mean={statistics.mean(ma):.0f} "
            f"ma_max={max(ma):.0f} a={last.get('a')}"
        )
        idle = all(o.get("st") == "idle" for o in recent)
        if idle and statistics.mean(ma) > 80:
            high_since = high_since or time.strftime("%H:%M:%S")
            log(f"WARN high idle current {statistics.mean(ma):.0f} mA since {high_since}")
        else:
            high_since = None


def stats(samples):
    ma = [o.get("ma", 0) for o in samples]
    if not ma:
        return {"n": 0}
    return {
        "n": len(ma),
        "mean": round(statistics.mean(ma)),
        "median": round(statistics.median(ma)),
        "max": max(ma),
    }


def wait(seconds):
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        time.sleep(0.02)


def test_finger(i, lo=60, hi=120, mid=90, hold=2.5):
    name = NAMES[i]
    log(f"TEST start finger {i} ({name}) jog {lo}->{hi}->{mid} deg")
    ev_mark = now()
    send({"t": "hello"})
    send({"t": "release"})
    wait(1.5)
    b0 = now()
    wait(2.0)
    base = stats(window(b0))
    log(f"TEST {name} idle before: {base}")
    phases = {}
    for label, deg in (("to_lo", lo), ("to_hi", hi), ("to_mid", mid)):
        p0 = now()
        send({"t": "jog", "i": i, "deg": deg})
        wait(hold)
        phases[label] = stats(window(p0))
        last = window(now() - 0.2)
        st = last[-1].get("st") if last else None
        md = last[-1].get("md") if last else None
        log(f"TEST {name} {label} ({deg} deg): {phases[label]} st={st} md={md}")
    send({"t": "release"})
    wait(1.5)
    a0 = now()
    wait(2.0)
    after = stats(window(a0))
    log(f"TEST {name} idle after release: {after}")
    with lock:
        errs = [o for (t, o) in events if t >= ev_mark and isinstance(o, dict) and o.get("t") in ("err", "evt")]
    motion_mean = max(p.get("mean", 0) for p in phases.values())
    motion_max = max(p.get("max", 0) for p in phases.values())
    delta = motion_mean - base.get("mean", 0)
    verdict = "CONSUME al moverse" if delta >= 30 or motion_max - base.get("max", 0) >= 60 else "NO consume (igual que apagado)"
    log(
        f"RESULT {name}: idle={base.get('mean')} mA, moving mean_max={motion_mean} mA, "
        f"peak={motion_max} mA, delta={delta} mA -> {verdict}; events={json.dumps(errs)}"
    )


def commands():
    pos = os.path.getsize(CMD) if os.path.exists(CMD) else 0
    while alive:
        time.sleep(0.1)
        if not os.path.exists(CMD):
            continue
        size = os.path.getsize(CMD)
        if size <= pos:
            pos = min(pos, size)
            continue
        with open(CMD, encoding="utf-8") as f:
            f.seek(pos)
            chunk = f.read()
            pos = f.tell()
        for line in chunk.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                log(f"ERROR bad command line: {line}")
                continue
            try:
                handle(obj)
            except Exception as exc:
                log(f"ERROR command {line}: {exc!r}")


def scan():
    for i in range(5):
        test_finger(i)
        wait(1.0)
    with open(LOG, encoding="utf-8") as f:
        results = [l.strip() for l in f if " RESULT " in l][-5:]
    log("SCAN done: " + " | ".join(r.split("RESULT ", 1)[1].split(";")[0] for r in results))


SAFETY = ("overcurrent", "watchdog", "boot", "ina_missing", "stop_button")


def burnin(seconds=120, lo=60, hi=120, limit=750, fingers=(0, 1, 2, 3, 4), dwell=1.4):
    """Round-robin jog of one servo at a time; abort and release on any safety event or error."""
    log(f"BURN start {seconds}s fingers={list(fingers)} {lo}<->{hi} deg limit={limit} mA")
    mark = now()
    send({"t": "limit", "ma": limit})
    send({"t": "release"})
    wait(1.5)
    i0 = now()
    wait(1.5)
    idle0 = stats(window(i0))
    log(f"BURN idle before: {idle0}")
    per = {i: {"means": [], "peak": 0} for i in fingers}
    end = time.perf_counter() + seconds
    rnd = 0
    reason = None
    while time.perf_counter() < end and reason is None:
        rnd += 1
        for i in fingers:
            w0 = now()
            for deg in (hi, lo):
                send({"t": "jog", "i": i, "deg": deg}, quiet=True)
                wait(dwell)
            st = stats(window(w0))
            per[i]["means"].append(st.get("mean", 0))
            per[i]["peak"] = max(per[i]["peak"], st.get("max", 0))
            with lock:
                bad = [o for (t, o) in events if t >= mark and isinstance(o, dict)
                       and (o.get("t") == "err" or (o.get("t") == "evt" and o.get("e") in SAFETY))]
            if bad:
                reason = json.dumps(bad[-1])
                break
        if rnd == 1 and reason is None:
            moved = [i for i in fingers if per[i]["peak"] > idle0.get("max", 0) + 20]
            if not moved:
                reason = "no current change on any servo: INA219 not measuring or no servo power"
        log("BURN round %d: %s" % (rnd, ", ".join(
            f"{NAMES[i]} mean={per[i]['means'][-1] if per[i]['means'] else '-'} peak={per[i]['peak']}" for i in fingers)))
    send({"t": "release"})
    wait(2.0)
    a0 = now()
    wait(2.0)
    idle1 = stats(window(a0))
    summary = "; ".join(
        f"{NAMES[i]}: avg={round(statistics.mean(per[i]['means'])) if per[i]['means'] else '-'} peak={per[i]['peak']}"
        for i in fingers)
    if reason:
        log(f"BURN ABORT after {rnd} rounds: {reason}")
    log(f"BURN done: rounds={rnd}; idle before={idle0.get('mean')} after={idle1.get('mean')} mA; {summary}")


def last_tel():
    with lock:
        return tel[-1][1] if tel else {}


def wait_pos(i, goal, timeout):
    """Wait until the commanded ramp of finger i reaches goal (0..1). Returns seconds taken or None."""
    start = time.perf_counter()
    while time.perf_counter() - start < timeout:
        a = last_tel().get("a") or [0, 0, 0, 0, 0]
        if abs(a[i] - goal) <= 0.02:
            return time.perf_counter() - start
        time.sleep(0.02)
    return None


def safety_since(mark):
    with lock:
        return [o for (t, o) in events if t >= mark and isinstance(o, dict)
                and (o.get("t") == "err" or (o.get("t") == "evt" and o.get("e") in SAFETY))]


def sweep(seconds=180, v=1.0, strokes=2, fingers=(0, 1, 2, 3, 4), lo=10, hi=170, limit=750):
    """Full-travel sweeps at the firmware's max target speed, one servo at a time (bench only)."""
    log(f"SWEEP start {seconds}s fingers={list(fingers)} {lo}<->{hi} deg v={v} strokes/turn={strokes} limit={limit} mA")
    mark = now()
    send({"t": "release"})
    wait(1.0)
    send({"t": "limit", "ma": limit})
    for i in range(5):
        send({"t": "calib", "i": i, "min": lo, "max": hi})
        wait(0.1)
    wait(0.5)
    bad = safety_since(mark)
    if bad:
        log(f"SWEEP ABORT before start: {json.dumps(bad[-1])}")
        send({"t": "release"})
        return
    i0 = now()
    wait(1.5)
    idle0 = stats(window(i0))
    per = {i: {"means": [], "peak": 0, "up": [], "down": [], "done": 0} for i in fingers}
    end = time.perf_counter() + seconds
    rnd, reason = 0, None
    while time.perf_counter() < end and reason is None:
        rnd += 1
        for i in fingers:
            w0 = now()
            for _ in range(strokes):
                f = [0.0] * 5
                f[i] = 1.0
                send({"t": "target", "f": f, "v": v}, quiet=True)
                up = wait_pos(i, 1.0, 4.0)
                wait(0.15)
                send({"t": "target", "f": [0.0] * 5, "v": v}, quiet=True)
                down = wait_pos(i, 0.0, 3.0)
                wait(0.15)
                if up is not None:
                    per[i]["up"].append(up)
                if down is not None:
                    per[i]["down"].append(down)
                per[i]["done"] += 1
                bad = safety_since(mark)
                if bad:
                    reason = json.dumps(bad[-1])
                    break
            st = stats(window(w0))
            per[i]["means"].append(st.get("mean", 0))
            per[i]["peak"] = max(per[i]["peak"], st.get("max", 0))
            if reason:
                break
        log("SWEEP round %d: %s" % (rnd, ", ".join(
            f"{NAMES[i]} mean={per[i]['means'][-1] if per[i]['means'] else '-'} peak={per[i]['peak']}" for i in fingers)))
    send({"t": "release"})
    wait(2.0)
    a0 = now()
    wait(2.0)
    idle1 = stats(window(a0))

    def avg(xs):
        return f"{statistics.mean(xs):.2f}s" if xs else "-"

    summary = "; ".join(
        f"{NAMES[i]}: strokes={per[i]['done']} avg={round(statistics.mean(per[i]['means'])) if per[i]['means'] else '-'} "
        f"peak={per[i]['peak']} up={avg(per[i]['up'])} down={avg(per[i]['down'])}"
        for i in fingers)
    if reason:
        log(f"SWEEP ABORT after {rnd} rounds: {reason}")
    log(f"SWEEP done: rounds={rnd}; idle before={idle0.get('mean')} after={idle1.get('mean')} mA; {summary}")


def handle(obj):
    kind = obj.get("t")
    if kind == "__sweep":
        args = {k: obj[k] for k in ("seconds", "v", "strokes", "lo", "hi", "limit") if k in obj}
        if "fingers" in obj:
            args["fingers"] = tuple(obj["fingers"])
        threading.Thread(target=sweep, kwargs=args, daemon=True).start()
    elif kind == "__burnin":
        args = {k: obj[k] for k in ("seconds", "lo", "hi", "limit", "dwell") if k in obj}
        if "fingers" in obj:
            args["fingers"] = tuple(obj["fingers"])
        threading.Thread(target=burnin, kwargs=args, daemon=True).start()
    elif kind == "__scan":
        threading.Thread(target=scan, daemon=True).start()
    elif kind == "__test_finger":
        threading.Thread(
            target=test_finger,
            args=(int(obj["i"]),),
            kwargs={k: obj[k] for k in ("lo", "hi", "mid", "hold") if k in obj},
            daemon=True,
        ).start()
    elif kind == "__quit":
        stop()
    else:
        send(obj)


def stop():
    global alive
    try:
        send({"t": "release"})
    except Exception:
        pass
    alive = False


log(f"MONITOR start on {PORT}")
for target in (rx, keepalive, summary, commands):
    threading.Thread(target=target, daemon=True).start()
send({"t": "hello"})
try:
    while alive:
        time.sleep(0.2)
finally:
    try:
        send({"t": "release"})
    except Exception:
        pass
    log("MONITOR stop (release sent)")
    s.close()
