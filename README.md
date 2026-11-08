# MakeCU — Guante robótico para rehabilitación de la mano

> **Nombre del producto: memo.** Marca, logo y voz en [`docs/brand/BRAND.md`](docs/brand/BRAND.md). "Rehab Hub" queda como nombre interno del repo y del plan.

**Track:** Healthcare
**Challenges que se suman:** MLH Gemini API, Trace (PCB custom), Zelos, Notability (opcional)

---

## Estado y cómo correrlo

| Parte | Estado |
|---|---|
| **Software** (app web, backend, firmware) | Construido y mergeado: WP0–WP12 en [`handoffs/STATUS.md`](handoffs/STATUS.md). Funciona entero con el **simulador**, sin hardware |
| **Hardware** | Guías y anclajes impresos. Falta imprimir módulo, tapa y carretes (`hardware/definitivas/2_...`), coser, cablear y probar |
| **Firmware en la placa** | Compila y pasa los tests nativos, pero **nunca se cargó en una ESP32**. Primero el banco de pruebas de [`firmware/BENCH.md`](firmware/BENCH.md) |

> **Five fingers are implemented end to end:** protocol, firmware, simulator, camera, exercise/evaluation, voice and history. Wire order is `[thumb, index, middle, ring, pinky]`, on GPIO25/26/27/13/4. Boards reporting another finger count are rejected. Physical acceptance remains pending in [`firmware/BENCH.md`](firmware/BENCH.md).

**Requisitos:** Node 20+, pnpm, Python 3.11+, [uv](https://docs.astral.sh/uv/), Chrome o Edge (Web Serial). PlatformIO solo para el firmware.

```sh
make setup        # instala backend y frontend
make demo-seed    # optional: 25 demo sessions (3 legacy), 5 opening evaluations, coach and voice records
make dev-sim      # API en :8000 + app en http://127.0.0.1:5173, guante simulado + cámara real (webcam)
make dev-sim-all  # guante y cámara simulados (sin webcam)
```

| Comando | Para qué |
|---|---|
| `make dev` | Igual que `dev-sim`, pero con el guante real por USB |
| `make dev-mock` | Solo el frontend, con la API simulada en el navegador |
| `make dev-camera` | Alias de `dev-sim` (webcam real + guante simulado) |
| `make test` / `make e2e` | pytest, vitest, TypeScript, Ruff, ESLint (+ tests nativos del firmware si hay `pio`) / Playwright |
| `make demo` | Compila el frontend y lo sirve desde el backend en http://127.0.0.1:8000 |
| `make fw-build` / `make fw-flash` | Compilar / cargar el firmware (**solo después del banco de pruebas**) |

- **Gemini:** copiar `backend/.env.example` a `backend/.env` y poner `GEMINI_API_KEY` (Google AI Studio). Es la única API key. Modelos: voz `gemini-3.8-live-extended-thinking` (razonamiento `medium`); resúmenes `gemini-4-argon` (requiere facturación), con caída automática a `gemini-3.8-flash`, `gemini-3.5-flash` y `gemini-3.5-flash-lite` si hay falta de cuota, saturación o lentitud (cada modelo tiene ~20 s; el plan gratuito de AI Studio da solo 20 pedidos por día por modelo, así que para una demo conviene una key con facturación). `cd backend && uv run python -m tools.summary_check` prueba los resúmenes en vivo contra la historia demo. Sin key, la app funciona igual con voz simple (frases fijas del navegador) y sin resúmenes.
- La app está **en inglés**. Este README es el concepto; el plan técnico detallado está en [`docs/plan/`](docs/plan/README.md) y el contrato (fuente de verdad) en [`docs/plan/03-contracts.md`](docs/plan/03-contracts.md).
- Más detalle: [`docs/DEV.md`](docs/DEV.md) (desarrollo), [`docs/DEMO.md`](docs/DEMO.md) (guion de demo de 6 min y cómo recuperarse de fallas), [`docs/HARDWARE_CHECKLIST.md`](docs/HARDWARE_CHECKLIST.md) (antes de ponerle el guante a alguien).

---

## 1. Extension-assist concept

Rehab Hub practices active hand closing and helps the patient **open** against
flexor tone. The same five servos wind tendons routed over the **back of the
fingers** (dorsal routing). Winding straightens a finger; unwinding releases it.
The glove can only reduce closure. A webcam measures the patient's movement,
a virtual hand shows the target, and a voice coach guides practice.

After a stroke, a hand may close into a fist but struggle to open. The patient
first makes a fist alone, then tries to open. The glove supplies only the missing
opening. Evaluation estimates **resistance to opening (flexor tone)** at slow and
fast speeds, with thread friction (threads unhooked from the fingertip anchors) subtracted. These are estimates inspired
by clinical practice, not validated clinical measurements.

## 2. A practice session

1. Calibrate the five servo ranges and camera in the current upright posture.
2. Make a fist actively. The glove follows with slack and pays out as you close.
3. Try to open. The camera records the opening achieved without help.
4. Only fingers still short of the opening target receive slow assistance.
   Orange means opening help; reaching the target turns the hand green.
5. Repeat fist → open five times: **10 attempts**. History, replay and Doctor view
   retain each attempt, assistance, current and safety events. Earlier records
   remain labeled **Earlier closing-assist glove**, with separate trend paths.

A calibration from the earlier closing glove (direction absent or `close`) must
be replaced. Its endpoints are unsuitable for dorsal routing.

## 3. Hardware: mano descubierta y asistencia de apertura

**Decisión del 8 de noviembre:** no hay guante de tela. Las guías son puntos
pequeños **NEGROS** en el dorso de las falanges proximales y medias; los anclajes
son puntos **AMARILLOS** en el dorso de cada punta de dedo. Se fijan directamente
a la piel con cinta apta para la piel; el equipo de hardware debe confirmar el
método de fijación, las posiciones y los tamaños exactos. Los hilos recorren el
dorso y abren la mano, según [15-open-assist.md](docs/plan/15-open-assist.md).
La app conserva el nombre **glove** para el dispositivo.

La cámara ve la palma descubierta, el mejor caso de MediaPipe. Los puntos y la
cinta no deben cubrir los pliegues articulares del lado de la palma. Usar buena
luz frontal, manga levantada, sin anillos ni reloj. El primer día, comprobar la
detección en Setup y guardar una grabación real de landmarks con
`frontend/src/vision/recorder.ts` que cubra `bare-hand-points`; registrar evidencia
en la sección **points** del banco (su incorporación corresponde al equipo).

**Seguridad:** probar primero en un soporte con forma de mano, antes de fijar
cualquier pieza a una persona. Revisar la piel antes y después de cada sesión:
enrojecimiento, marcas o dolor; una persona tras un ictus puede no sentir el roce.
Si se vuelve a fijar una guía o un anclaje, repetir la calibración de servos
antes de practicar: la tracción máxima se fija con los dedos rectos y un anclaje
movido puede extender un dedo demasiado.

Para evaluar, medir **Thread friction (unhooked)** con cada hilo desenganchado de
su anclaje amarillo y la mano relajada; alternativa: un soporte con forma de mano
con las guías fijadas del mismo modo. Volver a enganchar antes de evaluar.
Ver [16-bare-hand.md](docs/plan/16-bare-hand.md) para la decisión y sus pendientes.
Las referencias anteriores a fricción del guante vacío en las secciones 1 y 4
quedan superseded por este procedimiento de hilos desenganchados.

Existing CAD and wrist module: `hardware/`. The upright mounting, thread exits,
friction, usable travel and extension strength still require team validation.
The earlier palm-side routing is superseded by **dorsal tendons**. Do not copy
old diagrams or angle ranges into a person-mounted calibration.

- Wire order: thumb, index, middle, ring, pinky. Each has a servo/spool.
- `pull = 0`: slack tendon at calibrated `min`; a relaxed hand may remain curled.
- `pull = 1`: full calibrated opening at `max`, finger straight and neutral.
- Never swap `min` and `max` to reverse the anatomy: release, fault, STOP and
  watchdog always unwind to pull 0. Slack is the safe state.
- Calibrate **Slack** with a relaxed fist, tendon just taut; calibrate **Open**
  at straight, never bent back. Normal assist is capped at 95% of that range.
- Winding defaults to ≤0.20 range/s for assistance (≤0.30 only with consent).
  Unwinding in target and follow runs at 3.0/s; follow leaves 0.08 slack.
- Starts are staggered ≥150 ms with at most three winding motors. A sustained-load
  governor eases pull before the aggregate firmware current limit; all five held
  open can still consume substantial current.

**Hardware gate — pending, team only:** complete the electrical/firmware bench
checks and the ordered opening gates in [firmware/BENCH.md](firmware/BENCH.md),
recorded in [HARDWARE_CHECKLIST.md](docs/HARDWARE_CHECKLIST.md). Confirm winding
opens each finger on an empty fixture, calibrate, prove extension strength and a
2 s hold under the limit, measure the five-finger sustained hold, verify STOP
releases to slack in <0.5 s on a fixture, and test fast closing during follow.
Keep the glove off patients until every gate passes. If extension strength fails,
the team must revise the servo or spool/lever mechanism and repeat the gate.
Simulator acceptance does not establish physical force, comfort or safety.

### Spools and routing

Keep thread exits tangent and in the spool plane, with strain relief and smooth
guides. A 10 mm winding radius gives about 31 mm travel per half turn; measure
actual opening travel and force on the dorsal fixture. Greater radius increases
travel and reduces force. Micro-servo torque and the estimated 2–2.7× friction
loss do not prove the mechanism can open a spastic hand.

### Servos (los que tenemos)

| Dedo | Servo | Torque aprox. (4,8 V) | Por qué |
|---|---|---|---|
| Índice | TowerPro SG92R | ~2,5 kg·cm | El más fuerte: el dedo que más trabaja en la pinza |
| Medio | Miuzei MG90S | ~1,8–2,2 kg·cm | Engranajes de metal |
| Anular | Smraza S51 | ~1,6–1,8 kg·cm | Alcanza para un dedo que hace menos fuerza |
| Meñique | Smraza S51 | ~1,6–1,8 kg·cm | Ídem |
| Pulgar | Negro sin identificar | **medir** | Su alojamiento es 1,5 mm más grande |

- Torques de fichas de tiendas y fabricantes; varían entre fuentes.
- **Alojamientos universales:** hueco de 23,6 × 13,2 mm (los cuerpos miden 22,2–23 × 11,8–12,6) y agujeros alargados (±0,8 mm), porque la distancia entre agujeros cambia entre marcas.
- **Micro servos a propósito:** un servo grande (p. ej. 20 kg·cm) podría lastimar si el software falla o el dedo se traba. Con un micro servo, en el peor caso, el servo se frena.
- La altura del eje cambia 1–2 mm entre modelos: las salidas del frente tienen margen para eso.

### Electrónica

```
  Fuente 5 V (límite 2,5 A) ──> [INA219] ──> (+) 5 servos
                                   │ I2C              ▲ PWM
                                   ▼                  │
  Botón STOP ───────────────────> [ESP32-WROOM-32] ───┘
                                   │        └──> level shifter ──> NeoPixel Ring
                                   └── USB ──> laptop (cámara, mano virtual, voz, dashboard)
```

**The ESP32-WROOM-32 drives all five servos** with hardware PWM (LEDC, 50 Hz, 500–2500 µs pulses) through `ESP32Servo`. Firmware allocates **two LEDC timers** so the fifth servo can attach while the other four remain attached (PR #39). Verify all five together on the empty bench fixture; see `firmware/BENCH.md` step 4.

| Función | Pin ESP32 | Notas |
|---|---|---|
| Servo pulgar | GPIO 25 | |
| Servo índice | GPIO 26 | |
| Servo medio | GPIO 27 | |
| Servo anular | GPIO 13 | |
| Servo meñique | GPIO 4 | |
| NeoPixel (datos) | GPIO 33 | Level shifter (3,3 → 5 V) + resistencia de ~330 Ω |
| INA219 SDA / SCL | GPIO 21 / 22 | I2C |
| Botón STOP | GPIO 32 | `INPUT_PULLUP`, el botón va a GND |

- **Pines evitados:** 0, 2, 5, 12 y 15 (definen cómo arranca la placa) y 14 (saca pulsos al arrancar y haría saltar un servo).
- **Comunicación con la laptop por USB** (Web Serial desde Chrome).
- La ESP32, el INA219 y el level shifter van en la breadboard, **sobre la mesa** detrás del módulo. Los cables de los servos salen por la ranura de atrás del módulo.

### Alimentación

- **Fuente de laboratorio Facmogu en 5 V con límite de 2,5 A** (5 servos). Los servos **no** se alimentan desde la ESP32.
- **Capacitor de 470–1000 µF** entre 5 V y GND en la línea de los servos: amortigua el pico cuando arrancan varios a la vez, que si no puede resetear la ESP32.
- Firmware releases on total filtered current above the limit for 100 ms: **1500 mA default, 2200 mA maximum**, below the 2.5 A supply limit. Measure each actual servo and thread friction with fingertip anchors unhooked on the bench; provisional profiles are not measured force limits.
- El límite de corriente es un **corte físico**: aunque el software falle, la fuente no deja pasar más.
- **GND común** entre la fuente, los servos y la ESP32.
- Verificar los 5 V con el multímetro **antes** de conectar los servos.

### Seguridad

- Recorrido de cada servo **limitado por software** al rango cómodo de cada dedo, calibrado por persona.
- **Corte por corriente:** si el INA219 mide más que un umbral, los servos aflojan. Si la mano se resiste, el guante para en vez de forzar.
- **Botón STOP:** afloja todos los servos al instante.
- **Límite de corriente de la fuente** como última barrera.
- Extension assist: winding opens; releasing leaves the tendons slack.

### Puesta en la mesa

- **Laptop delante del paciente; cámara = webcam frontal de la laptop.** Levantar la mano afectada junto a la cara, vertical, con la **palma hacia la pantalla**, como al saludar en una videollamada. Abrir y cerrar los dedos hacia la cámara.
- **Codo apoyado en la mesa**, con una toalla o almohadilla cómoda; antebrazo vertical. Mantener la muñeca, la mano completa y las cinco puntas dentro del encuadre, a unos **40–60 cm de la laptop**. Ajustar la pantalla para encuadrar sin levantar el codo.
- **Luz difusa de frente o de costado, sin ventana detrás del paciente.** Comprobar en la vista de cámara que la palma y los dedos se vean iluminados, sin contraluz.
- **Palma descubierta con puntos negros y amarillos:** comprobar la detección en Setup durante cinco segundos al abrir y cerrar con la luz del lugar; registrar el porcentaje, las oclusiones y una grabación real de landmarks. Si falla, ajustar luz/encuadre y pedir revisión al equipo antes de usarlo.
- **Calibración nueva en esta postura:** no reutilizar las capturas con la palma hacia abajo y cámara diagonal. Hacer series cortas, descansar y pausar si sostener la mano levantada cansa.

**Hallazgos del banco real — leer [`hardware/BANCO.md`](hardware/BANCO.md) antes de conectar:** la primera sesión de Matias fue sin tendones ni guante y no reemplaza la aceptación de [`firmware/BENCH.md`](firmware/BENCH.md).

- **INA219 conectado antes de cualquier práctica física.** Sin el sensor, el firmware rechaza la asistencia (`target`/`follow`), aunque permite `jog`; que el servo se mueva y marque 0 mA sin sensor no demuestra seguridad.
- **La Facmogu real no tiene límite de corriente.** La descripción de una fuente limitada más arriba no corresponde a este adaptador: para la demo, usar un fusible elegido por el equipo o una fuente con límite. Para el guante, alimentar el riel a **5,0 V directamente a través del INA219**, sin pasar por el MB102, y con su propio capacitor de **470–1000 µF**. En un soporte vacío, probar el corte según BENCH con `limit 800` (JSON: `{"t":"limit","ma":800}`); registrar corriente, evento y liberación. Es un umbral de firmware de 800 mA para esa prueba, no un límite físico de la fuente ni un ajuste aprobado para una persona.
- **MB102 (~0,8 A): solo pruebas de un servo por vez en banco**, nunca práctica con el guante completo. Poner ambos jumpers en **5V**, medir la salida y mantener la Facmogu a **9 V o menos** al alimentar el MB102: su capacitor es de 10 V.
- **Verificar la polaridad de los rieles con multímetro antes de conectar servos.** No asumir el orden de las filas: un servo con rojo/marrón invertidos se calentó en segundos durante la prueba.
- **Banco manual con el firmware del repo:** enviar `ping` cada **~300 ms** durante el `jog` (JSON: `{"t":"ping"}`, terminado en salto de línea). Sin mensajes válidos durante más de 1 s, el watchdog afloja y entra en falla; no desactivarlo para probar.

**Pregunta pendiente para el equipo de hardware — resolver antes de usar el guante en una persona:** el módulo de muñeca se diseñó para descansar en la mesa con la palma hacia abajo. Con la mano vertical queda colgado del antebrazo. Las dos correas lo sostienen sin deslizarse ni apretar, su peso resulta cómodo y does the dorsal thread exit allow opening and slack release without rubbing or snagging? Comprobar también cómo cambia la acción de los elásticos y la tracción de los servos con la gravedad. Registrar la decisión y la evidencia en [`docs/HARDWARE_CHECKLIST.md`](docs/HARDWARE_CHECKLIST.md), primero en un soporte vacío; no asumir que el montaje anterior ya está validado.

### Piezas impresas

| Pieza | Estado | Medidas | Cant. |
|---|---|---|---|
| Guía de tendón | **Definitiva, ya impresa** (`hardware/definitivas/1_...`) | 12 × 9 × 5,6 mm, base cóncava | 13 (+3) |
| Anclaje de punta | **Definitiva** | 12 × 9 × 5,8 mm | 5 (+1) |
| Módulo de muñeca | Primera prueba | 80,5 × 80 × 41 mm | 1 |
| Tapa (cóncava, con orejas para correas) | Primera prueba | 80,5 × 102 × 6 mm | 1 |
| Carrete | Radio a confirmar | Ø 22 × 8,2 mm | 5 |

- Todo sale de `hardware/cad/piezas.py` (FreeCAD, paramétrico): `freecadcmd hardware/cad/piezas.py` regenera los STL en `hardware/stl/`.
- Para la mano izquierda: espejar módulo y tapa en el slicer.
- **Antes de imprimir el módulo:** medir el servo negro y comprobar el paso de 1,5 mm con los servos reales.

---

## 4. Software

> Lo que está construido. El detalle de cada parte (tipos, constantes, endpoints, umbrales) está en [`docs/plan/`](docs/plan/README.md); el contrato que comparten todas las partes es [`docs/plan/03-contracts.md`](docs/plan/03-contracts.md).

### 4.1 Qué hace

Una app web local (**Rehab Hub**) que corre en la laptop:
1. Le muestra al paciente una **mano virtual** con la posición objetivo (fantasma) y su mano real (sólida) superpuestas.
2. Mide con la **webcam** cuánto cierra cada dedo.
3. Commands the **glove** (ESP32 over USB) to supply missing opening only; closing is active practice.
4. Registra cada intento, lo muestra en un **historial** con gráficos y genera resúmenes con **Gemini**.
5. Un **coach de voz** (Gemini Live) guía la sesión. Los avisos de seguridad son locales e inmediatos.

### 4.2 Arquitectura

```
 Chrome / Edge (React + Vite)
   webcam ─> Visión (MediaPipe) ──┐                ┌─> Mano virtual (three.js)
                                  ▼                │
                 Runtime ─tick─> Motor de ejercicio / evaluación (TS puro)
                   │  ▲                │ comandos
                   │  └─ telemetría ───┴──> Web Serial ──USB──> ESP32 (o guante simulado)
                   ├─> Voz: red de seguridad local + coach Gemini Live
                   └─> API REST ──> FastAPI + SQLite (localhost:8000)
                                     sesiones, intentos, trazas, calibraciones,
                                     evaluaciones, historial, exportación, Gemini
```

- **Toda la lógica en tiempo real corre en el navegador.** El backend solo guarda datos, agrega el historial y habla con Gemini (así la API key no llega al navegador).
- **La seguridad no depende del navegador.** El firmware aplica límites, rampas, corte por corriente, STOP y watchdog por su cuenta; el navegador es una segunda capa (pausa si pierde la cámara, se anticipa a la resistencia).
- **Simulador (`SimWorld`):** un guante simulado que se comporta como el firmware, un modelo de paciente (severo, moderado, leve, con "índice rígido") y una cámara simulada. Permite desarrollar, testear y hacer la demo sin hardware.

| Carpeta | Qué hay |
|---|---|
| `frontend/` | React 18 + TypeScript + Vite, three.js (`@react-three/fiber`), MediaPipe Tasks Vision, Recharts, `@google/genai`. Tests con Vitest y Playwright |
| `backend/` | FastAPI + SQLModel + SQLite (WAL). Sirve también el frontend compilado. `tools/seed_demo.py` genera los datos de ejemplo |
| `firmware/` | PlatformIO, Arduino-ESP32. Lógica de seguridad en C++ puro con tests nativos (Unity) |
| `contracts/fixtures/` | Ejemplos de mensajes serie y REST que verifican las tres partes |
| `docs/plan/` | Plan técnico: producto, arquitectura, contratos, firmware, visión, sesión, voz, frontend, tests, UX |
| `handoffs/` | Encargos (WP0–WP12) con los que agentes de código construyeron cada parte, y su estado |
| `hardware/` | CAD, STL y visor 3D (sección 3) |

### 4.3 Pantallas

| Ruta | Pantalla |
|---|---|
| `/` | Inicio |
| `/setup` | Elegir guante (USB o simulado), cámara y mano afectada |
| `/calibrate` | Wizard: five servo ranges (jog) → open / closed / pinch camera range → review. Thread friction (unhooked) is in Evaluate preflight. |
| `/exercise` | Sesión de ejercicio (modo foco, sin navegación) |
| `/evaluate` | Evaluación de resistencia |
| `/history` | Tendencias de rango, ayuda y resistencia; repetición de cada sesión (`/history/sessions/:id`) y evaluación |
| `/doctor` | Vista del terapeuta (solo lectura): tendencias, resumen de Gemini a pedido, exportar JSON/CSV, imprimir |
| `/profile` | Perfil opcional del paciente |

En el encabezado hay un menú **Demo tools** para pasar a guante o cámara simulados en medio de la demo sin recargar.

### 4.4 Protocolo serie (laptop ↔ ESP32)

USB a **115200 baud**, una línea JSON compacta por mensaje (máx. 200 bytes). Los arrays de dedos van siempre en orden **[pulgar, índice, medio, anular, meñique]**.

| Laptop → ESP32 | Ejemplo | Qué hace |
|---|---|---|
| `target` | `{"t":"target","f":[0.8,0.6,0.6,0.5,0.5],"v":0.5}` | Target tendon pull (0 = slack, 1 = calibrated straight finger) at speed `v` |
| `follow` | `{"t":"follow","f":[0.3,0.4,0.1,0.2,0.2]}` | Follow vision converted to pull, subtracting 0.08 slack; unwind at 3.0/s |
| `release` | `{"t":"release"}` | Aflojar todo; también sale de `fault` |
| `calib` | `{"t":"calib","i":1,"min":20,"max":150}` | Servo angles for slack `min` and neutral-open `max`; not persisted on the board |
| `jog` | `{"t":"jog","i":1,"deg":95}` | Mover un servo a un ángulo, para calibrar |
| `limit` / `ping` / `hello` | `{"t":"limit","ma":1500}` | Umbral de corriente / keepalive / pedir `info` |

| ESP32 → laptop | Ejemplo |
|---|---|
| `tel` (50 Hz) | `{"t":"tel","ms":12345,"a":[0.42,0.40,0.35,0.30,0.30],"ma":312,"st":"run","md":"follow","tg":[0.42,0.45,0.40,0.35,0.35]}` |
| `evt` | `overcurrent`, `stop_button`, `stop_released`, `watchdog`, `boot`, `ina_missing`, `calib_ok` |
| `info` / `err` | Versión, cantidad de dedos, límite y calibración / comando rechazado y por qué |

`boot` events include optional `reset_reason` from `esp_reset_reason()`. Code **9** means brown-out: Setup and runtime status tell the helper to check the 470–1000 µF capacitor and the supply limit.

`a` es la posición **comandada** (los micro servos no informan la real). Estados: `boot → idle → run`, `calib` durante el jog, y `fault` tras un corte, hasta un `release`.

### 4.5 Seguridad en el firmware

Se aplica siempre, aunque la laptop diga otra cosa (detalle en [`firmware/README.md`](firmware/README.md)):
- Al arrancar, PWM desconectado: no recuerda calibración ni movimiento. `target` y `follow` se rechazan hasta calibrar todos los dedos.
- Stays within calibration: target winding ≤1 range/s, follow winding 1.5/s, unwinding 3.0/s.
- **Corte por corriente:** más del umbral (filtrado) durante 100 ms → afloja todo y queda en `fault`.
- **STOP:** se engancha al primer flanco; para seguir hay que soltarlo y mandar `release`.
- **Watchdog:** 1 s sin mensajes válidos → afloja todo.
- Release unwinds to pull 0 (slack), then detaches PWM after 500 ms.

### 4.6 Visión

- MediaPipe Hand Landmarker (modelo local en `frontend/public/models/`), 640×480 a 30 Hz.
- Cierre por dedo a partir de los ángulos de flexión, normalizado con la calibración del paciente y suavizado con filtro One Euro.
- Si la mano no se ve, la confianza baja o la cámara se traba (100 ms sin cuadros), el dato se invalida y la sesión no le pide nada nuevo al guante.
- Es una **estimación**, no un goniómetro.

### 4.7 Motor de sesión

Motor determinista en TypeScript (`frontend/src/engine/`), sin reloj propio, testeado con el simulador.

```
 PRESENT → ATTEMPT (follow) → reached → HOLD → RELEASE → REST
                  │
                  ├─ missing opening → ASSIST → ASSIST_HOLD → RELEASE
                  ├─ closing attempt ends → RELEASE (no help)
                  └─ fault / STOP / camera loss → PAUSED + slack
```

- **Default plan:** active full fist → assisted open, five pairs (10 attempts). `TENDON_GLIDE_PLAN` retains the five observation glides, three reps each; pinch remains optional.
- Assistance begins after the attempt timeout or plateau. Unreached fingers start at least **150 ms apart**, with at most **three moving at once**. Glove-assisted targets are capped at **0.95 of the calibrated range**; 100% calibration means a straight, neutral finger; never hyperextension. Only fingers lacking opening are assisted.
- All five fingers are scored in fist/open practice; closing poses receive follow only; pinch uses thumb and index. Evaluation accepts any subset, with one slow and one fast sweep per selected finger. Old three-finger sessions remain readable with missing ring/little-finger measurements.
- The simulator exposes rigid-finger resistance. Detection also covers a stall already present in the initial assist baseline; a single stall need not exceed the aggregate firmware current limit. See `docs/DEV.md` for the browser and unit regressions.
- **Evaluation:** from a relaxed, curled hand, sweep opening pull slowly and quickly. Subtract recent thread friction (threads unhooked from the yellow fingertip anchors) measured in Evaluate preflight; fast − slow estimates velocity dependence of flexor tone.

**Métricas por intento:** cierre activo máximo por dedo, tiempo hasta la posición, ayuda necesaria, corriente pico y media, eventos de seguridad, y una traza a 20 Hz para repetir el intento después.

### 4.8 Voz y Gemini

| Capa | Qué hace |
|---|---|
| **Red de seguridad local** | Sonidos y voz del navegador para los avisos de seguridad ("Stopping. I felt resistance in your index."). Funciona en cualquier modo, sin red |
| **Coach (Gemini Live)** | Da la instrucción, alienta, comenta cada intento y responde. Comandos de voz: pausa, seguir, saltar, repetir, parar, "cómo voy" |
| **Voz simple** | Frases fijas, sin key. Se activa sola si Gemini Live falla 3 veces |
| **Resúmenes (Gemini texto)** | Para el paciente al terminar la sesión y para el terapeuta a pedido desde `/doctor` |

Gemini solo recibe métricas resumidas, nunca video. Todo se presenta como acompañamiento, no como indicación médica.

### 4.9 Datos

SQLite en `backend/data/rehab.db`: perfil, calibraciones, sesiones, intentos con trazas, evaluaciones y transcripciones de voz. Exportable a JSON y CSV desde la vista del terapeuta. Demo data from `make demo-seed` contains 25 sessions (212 attempts, including three legacy closing sessions) and five opening evaluations over six weeks, with voice-coach decisions, check-ins and transcripts in the last 18 days. All carry `is_demo`; directions remain separated in history.

### 4.10 Pendiente

**Plan del equipo, paso a paso y con responsables:** [`docs/TEAM_PLAN.md`](docs/TEAM_PLAN.md).

- **Pasar de 3 a 5 dedos** (en curso): contrato (`docs/plan/03-contracts.md`, `contracts/fixtures/`, `firmware/lib/core/protocol.h`, `frontend/src/contracts/`, `backend/app/contracts/`) y todo lo que lo usa: firmware, calibración, mano virtual, métricas, gráficos, simulador, tests y prompt de voz.
- **Umbral de corriente para 5 servos:** medirlo en el banco de pruebas.
- **Probar el firmware en la placa** con [`firmware/BENCH.md`](firmware/BENCH.md) y después [`docs/HARDWARE_CHECKLIST.md`](docs/HARDWARE_CHECKLIST.md), sin el guante puesto.
- **Gemini con la key real:** confirmar que `/api/health` diga `gemini: true` y ensayar una conexión de voz y un resumen.
- Fuera de alcance: modo espejo, retiro gradual del feedback, acceso remoto, varios pacientes, otros idiomas.

---

## 5. Modos

| Modo | Qué hace | Qué mide |
|---|---|---|
| **Ejercicio** (principal) | Posiciones de terapia. El paciente intenta solo y el guante ayuda lo que falta | Cuánto llega solo cada dedo, tiempo hasta la posición, cuánta ayuda necesitó |
| **Evaluación** | From a relaxed curled hand, opens each selected finger slowly then quickly | Resistencia de cada dedo según la velocidad |
| **Espejo** (no construido) | Una mano sana frente a la cámara controla el guante | Nada: es para practicar y para la demo |

**Posiciones** (ejercicios reales de terapia de mano):
- **Deslizamiento de tendones:** mano abierta, gancho, puño completo, mesa, puño recto.
- **Oposición del pulgar:** tocar con el pulgar la punta de cada dedo (inspirado en el test de Kapandji).
- **Pinza:** pulgar e índice.

**Feedback que se retira** (no construido): en modo rehabilitación, la ayuda del guante y las luces se reducen de a poco (por ejemplo, del 100% de los intentos al 50%). El feedback constante genera dependencia.

---

## 6. Métricas

Por dedo y por intento:

- **Active opening:** how far the finger opens alone (0–100%), derived from open-pose closure. Closing ability is recorded separately by pose.
- **Tiempo hasta la posición.**
- **Ayuda necesaria:** cuánto recorrido completó el guante.
- **Resistencia:** corriente de los servos durante el modo evaluación, menos la del guante vacío (calibración).

La rigidez después de un ACV aumenta con la velocidad del movimiento. Comparar la resistencia a velocidad lenta y rápida es lo que el terapeuta evalúa a mano (escala de Ashworth).

> Comunicar todo como "estimación inspirada en la práctica clínica", **no** como medición validada.

---

## 7. El ángulo de Healthcare

| Población | Uso del guante |
|---|---|
| **ACV con mano parética** (protagonista) | Repeticiones asistidas y medición del rango y la rigidez |
| Lesión de tendón o post-cirugía de mano | Ejercicios de deslizamiento de tendones en casa |
| Lesión medular cervical | Opening practice after team and clinical assessment |
| Esclerosis múltiple, parálisis cerebral | Seguimiento de la rigidez en el tiempo |

**Telerrehabilitación:** el paciente practica en casa y el terapeuta ve el dashboard a distancia. Gemini genera un resumen semanal para el terapeuta.

---

## 8. Demo y pitch

El guion detallado (6 minutos, con qué decir en cada paso y cómo recuperarse si falla la cámara, el guante o Gemini) está en [`docs/DEMO.md`](docs/DEMO.md). Todo lo que fuerce resistencia o STOP se muestra con el simulador, nunca con la mano de una persona.

1. Use both simulators with the moderate patient. Make a fist alone, then watch the glove help open. Show blue active movement, orange opening help and green reach.
2. In the simulator, enable Rigid index during an opening. Show the resistance stop and its saved event. For STOP/overcurrent, show pause and slack; never deliberately stall a person's hand.
3. Show opening trends, an Open hand replay, and the two labeled legacy closing sessions. Evaluation measures resistance to opening (flexor tone).
4. Open Doctor view, request a summary if available, and export the marked records. Rehearse [docs/DEMO.md](docs/DEMO.md).

### Video de Devpost (3 min)

| Criterio | Qué mostrar |
|---|---|
| Problem solving | Paciente post-ACV, falta de horas de terapia, telerrehabilitación |
| Innovation | Ayuda solo lo que falta + medición de rigidez con la corriente de los servos |
| Technology | Visión por computadora, tendones artificiales, control de servos con corte por corriente, Gemini |
| Design | Guante liviano, servos en un módulo de muñeca, seguridad en capas |
| Completion | Demo en vivo |

---

## 9. Challenges a sumar

| Challenge | Cómo entra | Qué hace falta |
|---|---|---|
| **MLH Gemini API** | Coach de voz y resúmenes para el terapeuta | Usar la Gemini API |
| **Trace** | PCB del guante: ESP32 + conectores de servos + INA219 + STOP | Diseño en Trace, ERC/DRC, BOM, Gerbers, vista mecánica. Código `MAKECU-X-TRACE-26` |
| **Zelos** | Ver en vivo la corriente y los ángulos durante el desarrollo | Plan Academic con mail universitario |
| **Notability** (opcional) | Documentar el proceso | Taggear, 2+ capturas, 1–2 frases. Código `MAKECU` |

Touchtronix ya no aplica: no usamos el SensX25.

---

## 10. Lista de hardware

### Desk de CURC (órdenes del sitio de MakeCU)

| Orden | Ítem | Cant. |
|---|---|---|
| O-00039 | Facmogu Adjustable DC Power Supply | 1 |
| O-00039 | INA219 Current and Power Monitor | 1 |
| O-00039 | Tactile Push Buttons (Assorted) | 1 |
| O-00036 | ESP32 ESP-WROOM-32 Development Board | 2 (una de repuesto) |
| O-00036 | WS2812B NeoPixel Ring (24 px) | 1 |
| O-00036 | 4-channel Logic Level Shifter | 1 |
| O-00036 | INMP441 I2S Microphone | 1 (opcional: alcanza con el micrófono de la laptop) |
| O-00036 | Alligator Clip Test Lead | 2 |
| O-00014 | Audio Amplifier + Dweii Mini Speaker | 1 + 1 (opcional: alcanza con el parlante de la laptop) |
| O-00014 | Solderless Breadboard full + half | 1 + 1 |

Pedir que saquen de la O-00014: ESP32-CAM, Raspberry Pi AI Camera, USB 3.1 breakout y micrófono electret.

### Desk de MLH (en persona)

| Ítem | Cant. |
|---|---|
| Resistor Kit | 1 |
| Wire Spool | 1 |
| DMM, Wire Strippers, Flush Cutters | 1 c/u |
| Grove 3 Axis Digital (opcional, temblor) | 1 |

### Por fuera del inventario

- Cables micro-USB para las ESP32.
- Guante de tela fina o de ciclismo.
- Tanza o hilo encerado.
- Tubitos plásticos o sorbetes para las guías.
- Banda elástica para el dorso.
- Velcro (2 correas para el módulo).
- Cables jumper macho-macho y macho-hembra (5 servos a la breadboard).
- Hilo de coser resistente, aguja y gotita (para guías, anclajes y nudos).
- Capacitor electrolítico de 470–1000 µF para la línea de 5 V de los servos.

### Impresión 3D (Makerspace, Mudd 254)

Piezas en `hardware/`: módulo de muñeca, tapa, carretes, guías y anclajes (ver sección 3). Hacer la **capacitación del Makerspace temprano**. Máximo 4 h por impresión, 1 impresora por equipo.

---

## 11. Plan de trabajo

| Rol | Tarea | Estado |
|---|---|---|
| Software | App, backend, firmware, simulador, voz | **Hecho** (WP0–WP12). Falta probarlo con hardware real |
| Mecánica | Imprimir módulo, tapa y carretes; coser guías, anclajes y elásticos al guante | Guías y anclajes impresos |
| Electrónica | Cablear ESP32, INA219, STOP y servos; banco de pruebas de `firmware/BENCH.md` | Pendiente |
| Integración | Un dedo de punta a punta: calibrar, `follow`, asistencia, corte por corriente | Software integrated; physical opening strength gate pending |
| Pitch | Ensayar `docs/DEMO.md`, video de Devpost | Pendiente |

**Orden:** primero **un dedo + un servo + la cámara de punta a punta**. Después los otros cuatro.

### Riesgos

- **La mecánica es lo más difícil:** fricción del hilo, anclajes que se sueltan, guante que se corre. Probar con un solo dedo lo antes posible.
- **Servos:** ya los tenemos (SG92R, MG90S, 2× S51 y uno negro sin identificar). Falta medir el negro y confirmar que los 5 entran en sus alojamientos.
- **Opening travel and force:** measure dorsal travel, extension strength and sustained current on a fixture before finalizing spools.
- **Cámara con dedos tapados:** probar la posición de la webcam temprano.
- **Firmware nunca probado en una placa:** hacer el banco de pruebas temprano, con el guante sin poner.
- Si la mecánica falla, la app con el simulador (o con la cámara real y el guante simulado) sigue siendo una demo que funciona sola.
