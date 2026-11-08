# Banco de prueba: primera vez con la placa real (7/11/2026)

Registro de la primera prueba del firmware del repo en la placa real, sin tendones
y sin guante. **No reemplaza [firmware/BENCH.md](../firmware/BENCH.md)** ni marca
ninguno de sus pasos como aprobado: anota lo que vimos y lo que falta.

> **Estado actual del banco:** ver más abajo, en *Segunda sesión (8/11/2026)*. Ahí
> el INA219 ya está conectado, hay un capacitor propio en el riel de los servos y
> el firmware de `main` pasó una prueba completa en la placa (84/84).

## Hardware real (distinto de lo que asume el repo)

| Pieza | Lo que asume el repo | Lo que usamos |
| --- | --- | --- |
| Placa | ESP32-WROOM-32 | ESP32 DevKit de 30 pines (chip ESP32-D0WD-V3, USB CP2102) |
| Fuente | Laboratorio, 5 V con límite de 2,5 A | Adaptador Facmogu regulable 3–12 V / 5 A, **sin límite de corriente**, en 7,5 V, entrando a un módulo de breadboard MB102 (regulador AMS1117 a 5 V, ~0,8 A como máximo) |
| Capacitor del riel de servos | 470–1000 µF cerca de los conectores | Solo el del MB102 (470 µF / 10 V, según lo impreso). Se pueden pedir más |
| Servos | SG92R, MG90S, 2 × S51 y uno negro sin identificar | 3 × Smraza S51 y 2 de otra marca, todavía sin identificar ni medir |
| INA219 | En el + de los servos | Todavía sin soldar ni conectar |

## Cableado usado

- MB102 clavado en la punta de la breadboard, con **los dos jumpers amarillos en 5V**.
- Servos: rojo a la fila **+**, marrón a la fila **−**, señal: pulgar GPIO25,
  índice GPIO26, medio GPIO27, anular GPIO13, meñique GPIO4.
- GND de la ESP32 a la fila **−**. VIN de la ESP32 sin conectar. ESP32 por USB a la laptop.
- STOP: pulsador en e8/e10/f8/f10 de la breadboard, d10 a GPIO32 y g8 a la fila **−**.

## Resultados

| Prueba | Resultado | Cómo se vio |
| --- | --- | --- |
| Carga del firmware | `pio run -e esp32dev -t upload` funciona en COM3 | Salida de esptool |
| Identidad | `hello` responde `{"t":"info","fw":"0.1.0","fingers":5,"limit":1500,"calib":[null,null,null,null,null]}` | Monitor serie |
| `jog` de cada dedo, sin tendones | Los 5 servos se mueven, de a uno, entre 60° y 120°, a la velocidad limitada del firmware | A ojo |
| 5 canales conectados a la vez | El meñique (índice 4) se movió con los otros 4 todavía conectados, porque no hubo `release` entre dedos | A ojo |
| STOP | `evt stop_button` y estado `fault`; al soltar llega `stop_released` y la falla sigue trabada; solo un `release` explícito la destraba | Monitor serie |
| Sin INA219 | `ma` queda en 0 y `jog` funciona igual | Monitor serie |
| Temperatura | Los 5 servos fríos después de las pruebas | Al tacto |

No medimos: velocidad real, corrientes por servo, pulsos en GPIO4/13 al arrancar,
rechazo de ángulos fuera de 5–175°, watchdog, corte por corriente ni brown-out.

## Incidentes y aprendizajes

1. **Polaridad invertida.** En esta breadboard la fila de arriba de todo es **−** y
   la segunda es **+** (abajo es al revés). El rojo y el marrón del servo del índice
   quedaron cambiados y el servo se calentó en segundos. Sobrevivió. Guiarse por los
   signos impresos y medir con el multímetro antes de enchufar servos.
2. **Jumper del MB102 en 3.3.** La fila de los servos daba 3,2 V y ningún servo se
   movía, sin ningún error en la placa. Con el jumper en 5V, los 5 se mueven.
3. **El MB102 no alcanza para el guante.** Da ~0,8 A: sirve para mover servos de a
   uno en el banco, no para cerrar una mano. Para el guante, la Facmogu en 5,0 V
   tiene que ir directo al riel de servos (a través del INA219), con un capacitor
   de 470–1000 µF propio.
4. **Con el MB102, la Facmogu no debe pasar de 9 V**: su capacitor es de 10 V.
5. Una sesión de banco manual necesita `ping` cada ~300 ms durante el `jog`; sin eso
   el watchdog afloja todo después de 1 s.

## Para decidir en equipo

- **Sin límite de corriente en la fuente.** El README del firmware dice que un solo
  dedo trabado (650–800 mA estimados) no llega al corte de 1500 mA y que lo frena,
  entre otras cosas, el límite de la fuente. Con la Facmogu esa capa no existe.
  Propuesta: probar el corte con un límite bajo (por ejemplo `limit 800`) y
  conseguir una fuente con límite o un fusible para la demo.
- Medir e identificar los 2 servos de la otra marca y completar las tablas de BENCH.md.

## Segunda sesión (8/11/2026): armado de a poco y prueba completa

Con todo conectado de una vez no andaba y no había forma de saber qué fallaba. Se
desarmó y se volvió a armar en pasos, probando cada uno antes de seguir. Después se
cargó el firmware de `main` @ `091b447` y se corrió una prueba automática completa en
la placa. Sigue siendo **sin tendones y sin guante**: no aprueba ningún paso de
BENCH.md.

### Qué cambió en el banco

| Pieza | Primera sesión | Ahora |
| --- | --- | --- |
| 5 V de los servos | Patitas del MB102, los dos jumpers en 5V | **Jumper del lado USB sacado.** Cable de la patita 5V de la tira del medio del MB102 → `VIN+` del INA219 → `VIN−` → fila **+** de los servos. Cable de la patita GND de la tira del medio → fila **−** |
| INA219 | Sin soldar | Soldado, fuera de la breadboard: `VCC`→3V3, `GND`→GND (lado derecho de la ESP32), `SDA`→GPIO21, `SCL`→GPIO22 |
| Capacitor del riel de servos | Solo el del MB102 | **470 µF / 25 V** entre la fila + y la fila − de los servos, además del del MB102 |
| Firmware | El de esa tarde | `main` @ `091b447` (incluye el cambio a "open-assist") |
| STOP | Conectado | **Sin conectar** en esta sesión |

La Facmogu sigue en 7,5 V entrando al MB102. Pines de los servos: sin cambios.

### Armado de a poco

| Paso | Qué se conectó | Cómo se comprobó |
| --- | --- | --- |
| 1 | Solo el MB102 con la fuente | Multímetro: 5 V entre las patitas 5V y GND de la tira del medio |
| 2 | Índice (GPIO26) con 5 V directo, sin INA219 | `jog` 20°↔160°: se mueve y queda frío |
| 3 | INA219, solo los 4 cables de datos | Al reiniciar, la placa ya no avisa `ina_missing` (sí lo avisaba en la primera sesión) |
| 4 | 5 V pasando por el INA219 | `jog` del índice: 3 mA quieto, 200–240 mA moviéndose, pico de 453 mA |
| 5 | Los otros 4 servos, de a uno | Cada uno se mueve con `jog` y la corriente en reposo vuelve a ~4 mA por servo |

### Incidente: la luz del MB102 no prendía

Al conectar los 4 servos que faltaban **todos juntos**, la luz del MB102 prendía y se
apagaba o no prendía, incluso dejando uno solo. Ningún servo respondía, y el INA219
marcaba **160–210 mA constantes, sin movimiento**: algo tiraba corriente y ahogaba al
regulador. Ningún servo estaba caliente. Sin ningún servo conectado la luz prendía y
la corriente daba 0 mA. Al volver a sumarlos **de a uno**, mirando la corriente en
reposo después de cada uno, el problema no volvió a aparecer. Lo más probable es que
uno haya quedado mal enchufado.

**Aprendizaje:** sumar los servos de a uno y mirar la corriente en reposo: unos 4 mA
por servo. Si con todo quieto da cientos de mA, hay un servo al revés o un corto.

Otros dos avisos de esa sesión:
- Un `ina_missing` en pleno uso, mientras se tocaban los cables del INA219. El
  firmware deja de usar el sensor hasta reiniciar, como está diseñado. Un reinicio lo
  recuperó.
- Varios `stop_button` falsos sin botón conectado, mientras se movían cables cerca de
  GPIO32. Sin botón, no dejar cables sueltos en ese pin.

### Prueba completa en la placa: 84/84

Con [`firmware/tools/hil_test/hil_test.py`](../firmware/tools/hil_test/hil_test.py)
(ver *Herramienta: prueba completa* más abajo). Se corrió tres veces completa; la
última, ya con el capacitor, dio **84 pruebas bien, 0 fallas**.

| Sección | Qué se prueba | Resultado |
| --- | --- | --- |
| A. Arranque | `evt boot` con `reset_reason`, `info`, INA219 encontrado, telemetría | 8/8. Telemetría a 49,5–50,5 Hz, líneas de 116 bytes como máximo, 19 mA en reposo |
| B. Comandos | `hello`, campos de más, CRLF, `limit` (900, 50→100, 5000→2200) y 19 líneas que tiene que rechazar: `bad_json`, `unknown_type`, `bad_args`, `no_calib`, línea de más de 200 bytes, NaN, 9 niveles de anidado | 27/27. Ninguna línea rechazada movió nada |
| C. Motores | `jog` 60°→120°→90° de cada dedo, y los límites de 5° y 175° | 7/7 |
| D. Watchdog | Sin mensajes en reposo no salta. Con un `jog` activo, salta y queda en `fault` hasta `release` | 5/5. Salta a los **1,01–1,05 s** del último `ping` |
| E. Sobrecorriente | `limit 100` y `jog` del medio | 5/5. Corta a los **0,26–0,30 s** (informa 355–376 mA), queda en `fault` y la corriente baja |
| F. Calibración | `calib` durante un `jog` → `state`; un rango inválido borra ese dedo; 5 rangos (medio y meñique espejados) → `calib_ok` | 6/6 |
| G. Ejercicio | `target` 0,6 a 0,5 rangos/s en cada dedo; aflojar; velocidad pedida 5 → 1 rango/s; `follow` con 8% de margen; `jog`/`calib` en ejercicio → `state`; `release` y watchdog en ejercicio; los 5 dedos escalonados | 23/23. `target`: 1,19–1,24 s (esperado 1,2). Afloja en 0,22–0,26 s (esperado ~0,2). `follow`: `tg` 0,52, llega en 0,37–0,38 s |
| H. Final | Sin reinicios, sin perder el INA219, termina en `idle` | 3/3 |

Demora entre mandar un `target` y verlo en la telemetría: mediana 31–47 ms, máximo
47–78 ms (5 medidas por corrida).

Un detalle para quien vuelva a escribir pruebas así en Windows: `time.monotonic()`
avanza de a ~15,6 ms. Con ese reloj, cada respuesta parecía de un comando anterior y
dio 4 fallas falsas. El script usa `time.perf_counter()`.

### Corriente medida (5 V del MB102, a través del INA219, sin tendones)

| Dedo | Pin | Moviéndose (`jog`) | Pico en `jog` | Pico en `target` 0,6 |
| --- | --- | --- | --- | --- |
| Pulgar | GPIO25 | 55–90 mA | 144–403 mA | 382–841 mA |
| Índice | GPIO26 | 145–170 mA | 332–455 mA | 429–528 mA |
| Medio | GPIO27 | ~300 mA | 335–457 mA | 402–589 mA |
| Anular | GPIO13 | 20–180 mA, a pasitos (es de otra marca) | 297–334 mA | 298–396 mA |
| Meñique | GPIO4 | ~130 mA | 510–617 mA | 195–325 mA |

En reposo, los 5 juntos: 19 mA. Los 5 dedos escalonados a 0,3 de tiro: pico total de
475 y 707 mA sin el capacitor nuevo, y 551 mA con el capacitor (un solo dato, no
alcanza para concluir nada sobre el capacitor).

### Para la demo y lo que falta

- **Fuente:** el MB102 da ~0,8 A, y con los 5 dedos moviéndose ya se llega a
  550–700 mA **sin carga**. Decisión para la demo: **abrir un dedo a la vez**. La app
  hoy arranca los 5 con 150 ms de diferencia, así que para la demo hay que esperar a
  que cada dedo llegue antes de arrancar el siguiente. Ojo: con una mano de verdad,
  sostener los 5 abiertos al final suma corriente y puede no alcanzar. La solución es
  la Facmogu en 5,0 V (medidos) directo a `VIN+`, sin el MB102, con un fusible de
  2,5 A y un adaptador de la ficha redonda a bornera.
- **Límite:** el `limit` por defecto (1500 mA) es mayor que lo que da el MB102.
  Mientras se use el MB102, mandar un `limit` de ~750 hace que la placa corte con
  `overcurrent` en vez de quedarse sin fuerza.
- **STOP:** conectarlo antes de ponerle el guante a alguien. Es parte de la "opening
  glove gate" de BENCH.md (STOP y watchdog con la mano sostenida abierta).
- **Calibración real:** los rangos de esta prueba (60–120°) son de banco. Hay que
  calibrar con el guante, como dice el README del firmware.
- **Tests de PC:** `pio test -e native` no corre en la laptop de la sesión (no tiene
  `gcc`) y el repo no tiene GitHub Actions. Hoy nadie los corre. Propuesta: una
  Action que corra `pio test -e native`.
- **No probado en este banco:** botón STOP, arranque sin INA219, brown-out o USB
  desconectado en movimiento, anillo de LEDs, servo trabado a mano y pulsos en
  GPIO4/13 al arrancar (hace falta osciloscopio).

## Herramienta: prueba completa (`hil_test.py`)

[`firmware/tools/hil_test/hil_test.py`](../firmware/tools/hil_test/hil_test.py)
prueba en la placa real todo lo que se puede probar sin tendones, sin STOP y sin
anillo, e imprime PASS/FAIL por prueba. **Solo en el banco:** mueve los 5 servos,
reinicia la placa y cambia el `limit` (100 y 750 mA) y al final lo vuelve a 1500.
Hay que cerrar cualquier monitor serie antes. Usa `pyserial`, que viene con el
Python de PlatformIO:

```sh
python firmware/tools/hil_test/hil_test.py COM3 resultados.json      # todo, ~3 minutos
python firmware/tools/hil_test/hil_test.py COM3 resultados.json B    # solo comandos, sin mover nada
```

En Windows, con PlatformIO instalado con `uv`, ese Python está en
`%APPDATA%\uv\tools\platformio\Scripts\python.exe`.

## Herramienta: sketch de prueba

[`firmware/tools/prueba_placa/prueba_placa.ino`](../firmware/tools/prueba_placa/prueba_placa.ino)
es un sketch de Arduino (no PlatformIO) que mueve un servo en GPIO26 con ángulos
escritos en el monitor serie y avisa cada vez que se aprieta el STOP. Sirve para
separar un problema de cables de uno del firmware. Se compila con el core
`esp32:esp32` 3.x y la librería ESP32Servo 3.x:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 --upload -p COM3 firmware/tools/prueba_placa
```

Después hay que volver a cargar el firmware del repo.

## En Windows

- `make dev` no funciona todavía: el Makefile llama a `python3` y `scripts/dev.py`
  no encuentra `pnpm` (es un `.cmd`). Mientras tanto: `cd backend; uv run python -m app`
  y `cd frontend; pnpm dev` en dos terminales.
- `pnpm test` en `frontend/`: `src/runtime/backend.test.ts` falla al limpiar
  (`EBUSY` sobre `runtime.db`) porque el `python.exe` de uvicorn queda vivo.
