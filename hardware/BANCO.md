# Banco de prueba: primera vez con la placa real (7/11/2026)

Registro de la primera prueba del firmware del repo en la placa real, sin tendones
y sin guante. **No reemplaza [firmware/BENCH.md](../firmware/BENCH.md)** ni marca
ninguno de sus pasos como aprobado: anota lo que vimos y lo que falta.

> Tercera sesión (8/11, mañana, 5 servos S51, arreglos de [ARREGLOS.md](ARREGLOS.md)):
> [BANCO-3.md](BANCO-3.md).

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
