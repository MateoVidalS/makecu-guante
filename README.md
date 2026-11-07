# MakeCU — Guante robótico para rehabilitación de la mano

**Track:** Healthcare
**Challenges que se suman:** MLH Gemini API, Trace (PCB custom), Zelos, Notability (opcional)

---

## Estado y cómo correrlo

| Parte | Estado |
|---|---|
| **Software** (app web, backend, firmware) | Construido y mergeado: WP0–WP12 en [`handoffs/STATUS.md`](handoffs/STATUS.md). Funciona entero con el **simulador**, sin hardware |
| **Hardware** | Guías y anclajes impresos. Falta imprimir módulo, tapa y carretes (`hardware/definitivas/2_...`), coser, cablear y probar |
| **Firmware en la placa** | Compila y pasa los tests nativos, pero **nunca se cargó en una ESP32**. Primero el banco de pruebas de [`firmware/BENCH.md`](firmware/BENCH.md) |

> **Se usan los 5 dedos.** El software se construyó primero para 3 (pulgar, índice y medio) y **se está pasando a 5**: protocolo, firmware, app, simulador y prompt de voz. Hasta que ese cambio esté en main, el firmware solo mueve los servos de GPIO 25, 26 y 27.

**Requisitos:** Node 20+, pnpm, Python 3.11+, [uv](https://docs.astral.sh/uv/), Chrome o Edge (Web Serial). PlatformIO solo para el firmware.

```sh
make setup        # instala backend y frontend
make demo-seed    # opcional: 11 sesiones y 4 evaluaciones de ejemplo (marcadas como demo)
make dev-sim      # API en :8000 + app en http://127.0.0.1:5173, con guante y cámara simulados
```

| Comando | Para qué |
|---|---|
| `make dev` | Igual que `dev-sim`, pero con guante (USB) y cámara reales |
| `make dev-mock` | Solo el frontend, con la API simulada en el navegador |
| `make test` / `make e2e` | pytest, vitest, TypeScript, Ruff, ESLint (+ tests nativos del firmware si hay `pio`) / Playwright |
| `make demo` | Compila el frontend y lo sirve desde el backend en http://127.0.0.1:8000 |
| `make fw-build` / `make fw-flash` | Compilar / cargar el firmware (**solo después del banco de pruebas**) |

- **Gemini:** copiar `backend/.env.example` a `backend/.env` y poner `GEMINI_API_KEY`. Sin key, la app funciona igual con voz simple (frases fijas del navegador) y sin resúmenes.
- La app está **en inglés**. Este README es el concepto; el plan técnico detallado está en [`docs/plan/`](docs/plan/README.md) y el contrato (fuente de verdad) en [`docs/plan/03-contracts.md`](docs/plan/03-contracts.md).
- Más detalle: [`docs/DEV.md`](docs/DEV.md) (desarrollo), [`docs/DEMO.md`](docs/DEMO.md) (guion de demo de 6 min y cómo recuperarse de fallas), [`docs/HARDWARE_CHECKLIST.md`](docs/HARDWARE_CHECKLIST.md) (antes de ponerle el guante a alguien).

---

## 1. La idea

Un guante que **ayuda a mover los dedos** de una mano afectada (por ejemplo, después de un ACV) y **mide cuánto puede moverlos la persona sola**.

- La pantalla muestra una **mano virtual** con la posición que hay que hacer: puño, gancho, pinza.
- El paciente **intenta hacerla** con la mano afectada. Una webcam mide hasta dónde llega cada dedo.
- Si no llega, **el guante completa el movimiento**: servos en un módulo bajo la muñeca tiran de hilos que funcionan como tendones y cierran los dedos.
- Un medidor de corriente detecta cuánto **se resiste la mano** al movimiento (rigidez o espasticidad, muy comunes después de un ACV).
- Un asistente de voz (Gemini) guía la sesión y resume la evolución para el terapeuta.

**Problema clínico.** Después de un ACV, muchas personas no pueden cerrar o abrir bien la mano. Recuperarla requiere cientos de repeticiones por día, y no hay terapeutas para tantas horas. El guante permite practicar en casa, ayuda solo lo que hace falta ("assist-as-needed") y mide el progreso sesión a sesión.

---

## 2. Cómo es una sesión

1. La mano virtual muestra la posición objetivo y la voz dice: "Vamos a hacer un puño. Intentalo".
2. El paciente intenta. La cámara mide cuánto cierra cada dedo (0% abierto, 100% cerrado).
3. Después de unos segundos, el sistema registra hasta dónde llegó solo: por ejemplo, índice al 40%.
4. El guante completa el resto. La mano virtual se pone verde.
5. Al final, Gemini resume: "Hoy cerraste el índice solo hasta el 55%. La semana pasada llegabas al 40%".

Se trabaja **solo con la mano afectada**. El objetivo lo pone la mano virtual.

---

## 3. Hardware

Modelo 3D interactivo: https://claude.ai/artifact/S1sEcqtCqwnj84THoCpWto · Piezas y CAD en `hardware/`.

### Resumen

```
   Vista de costado (palma hacia abajo)

        correa      correa
   ═════[══]═════════[══]══╗ mano ═══ guías ═══ ● punta
   antebrazo  ┌─────────────┐ ╲ hilos pegados a la palma
              │ MÓDULO DE   │──╲───────────────────────────
              │ MUÑECA      │ salen por arriba del frente, ~10° hacia la palma
              │ 5 servos    │
   ───────────┴─────────────┴──── borde de la mesa
```

- **Módulo de muñeca** impreso (80,5 × 80 × 47 mm con la tapa) debajo de la muñeca y el antebrazo, sujeto con **dos correas de velcro**: una alrededor de la mano y otra del antebrazo.
- **Fija la muñeca:** el módulo es rígido y abarca la muñeca. Si la muñeca no se dobla, el largo de cada hilo no cambia. Por eso no hacen falta fundas ni tubos.
- **5 servos adentro, uno por dedo**, cada uno en su propio soporte.
- **Hilos pegados a la piel:** salen por arriba del frente del módulo y corren por la palma, por guías cosidas al guante, hasta la punta de cada dedo.
- **Elásticos en el dorso:** abren el dedo cuando el servo afloja. El guante solo tira para cerrar.

### Física del enrollado (por qué el módulo es así)

- **El hilo tiene que salir del carrete en su plano** (desvío ≤ 2–4°). Si sale inclinado se sube al ala del carrete, enrolla desparejo, se puede salir y carga de costado el eje del servo. Por eso:
  - los **5 carretes están a la misma altura**, justo debajo de la tapa;
  - cada hilo sale **horizontal y tangente** a su carrete, por una salida abocinada del frente;
  - desde ahí sube **unos 10°** hasta la guía de la palma (la única curva del módulo, ~4% de fricción extra).
- **Zigzag:** 5 carretes de Ø22 no entran en 80 mm en una fila. Van 3 adelante (pulgar, medio, meñique) y 2 atrás (índice, anular); los hilos de atrás pasan por el **hueco de 1,5 mm** entre los carretes de adelante.
- **Fricción total estimada:** el servo tira ~2–2,7× lo que llega a la punta (las curvas de las articulaciones son inevitables). Un diseño anterior con hilos saliendo a 45° por la tapa daba ~4–5× y no habría cerrado la mano.
- **Carrete:** radio de enrollado 10 mm → brazo de palanca constante y ~31 mm de hilo por 180°. Cerrar un dedo del todo pediría ~40–45 mm (estimado): con 31 mm se llega a ~70% de un puño. **Medir** en el guante; si falta, subir el radio (más recorrido, menos fuerza).

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

**Los servos los controla directamente la ESP32-WROOM-32** con PWM por hardware (LEDC, 50 Hz, pulsos de 500–2500 µs) y la librería `ESP32Servo`. No hace falta driver (el PCA9685 está agotado y la ESP32 tiene 16 canales PWM).

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
- El firmware corta si la corriente total filtrada supera el umbral durante 100 ms. El umbral de 900 mA se eligió para 3 servos: **ajustarlo para 5 en el banco de pruebas**, midiendo el consumo real del guante vacío.
- El límite de corriente es un **corte físico**: aunque el software falle, la fuente no deja pasar más.
- **GND común** entre la fuente, los servos y la ESP32.
- Verificar los 5 V con el multímetro **antes** de conectar los servos.

### Seguridad

- Recorrido de cada servo **limitado por software** al rango cómodo de cada dedo, calibrado por persona.
- **Corte por corriente:** si el INA219 mide más que un umbral, los servos aflojan. Si la mano se resiste, el guante para en vez de forzar.
- **Botón STOP:** afloja todos los servos al instante.
- **Límite de corriente de la fuente** como última barrera.
- Extensión pasiva: el guante solo tira para cerrar.

### Puesta en la mesa

- **Palma hacia abajo**, con el frente del módulo en el borde de la mesa: la mano queda afuera y los dedos se cierran en el aire.
- **Antebrazo sobre una toalla doblada** (~4 cm), desde el codo hasta justo antes del módulo.
- **Webcam** adelante y del lado del pulgar (rincón de la mesa), a 30–40 cm de los dedos y más alta que la mano, en diagonal: ve los dedos de costado sin que se tapen. Logitech del desk de MLH en un trípode chico.
- **Laptop** adelante del paciente, del lado del pulgar, con la pantalla hacia él.
- **Guante claro y fino:** MediaPipe se entrena con manos sin guante; un guante oscuro puede hacer que no detecte los dedos. Probarlo el primer día.

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
3. Le pide al **guante** (ESP32 por USB) que complete el movimiento cuando el paciente no llega.
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
| `/calibrate` | Asistente: rango de cada servo (jog) → cámara mano abierta / cerrada / pinza → fricción del guante vacío |
| `/exercise` | Sesión de ejercicio (modo foco, sin navegación) |
| `/evaluate` | Evaluación de resistencia |
| `/history` | Tendencias de rango, ayuda y resistencia; repetición de cada sesión (`/history/sessions/:id`) y evaluación |
| `/doctor` | Vista del terapeuta (solo lectura): tendencias, resumen de Gemini a pedido, exportar JSON/CSV, imprimir |
| `/profile` | Perfil opcional del paciente |

En el encabezado hay un menú **Demo recovery** para pasar a guante o cámara simulados en medio de la demo sin recargar.

### 4.4 Protocolo serie (laptop ↔ ESP32)

USB a **115200 baud**, una línea JSON compacta por mensaje (máx. 200 bytes). Los arrays de dedos van siempre en orden **[pulgar, índice, medio, anular, meñique]**.

| Laptop → ESP32 | Ejemplo | Qué hace |
|---|---|---|
| `target` | `{"t":"target","f":[0.8,0.6,0.6,0.5,0.5],"v":0.5}` | Ir al cierre objetivo (0–1) a velocidad `v` (fracción del rango por segundo) |
| `follow` | `{"t":"follow","f":[0.3,0.4,0.1,0.2,0.2]}` | Enrollar el hilo flojo hasta 5% menos de lo que ve la cámara, sin tirar |
| `release` | `{"t":"release"}` | Aflojar todo; también sale de `fault` |
| `calib` | `{"t":"calib","i":1,"min":20,"max":150}` | Ángulos del servo para 0% y 100% del dedo `i` (no se guardan en la placa) |
| `jog` | `{"t":"jog","i":1,"deg":95}` | Mover un servo a un ángulo, para calibrar |
| `limit` / `ping` / `hello` | `{"t":"limit","ma":900}` | Umbral de corriente / keepalive / pedir `info` |

| ESP32 → laptop | Ejemplo |
|---|---|
| `tel` (50 Hz) | `{"t":"tel","ms":12345,"a":[0.42,0.40,0.35,0.30,0.30],"ma":312,"st":"run","md":"follow","tg":[0.42,0.45,0.40,0.35,0.35]}` |
| `evt` | `overcurrent`, `stop_button`, `stop_released`, `watchdog`, `boot`, `ina_missing`, `calib_ok` |
| `info` / `err` | Versión, cantidad de dedos, límite y calibración / comando rechazado y por qué |

`a` es la posición **comandada** (los micro servos no informan la real). Estados: `boot → idle → run`, `calib` durante el jog, y `fault` tras un corte, hasta un `release`.

### 4.5 Seguridad en el firmware

Se aplica siempre, aunque la laptop diga otra cosa (detalle en [`firmware/README.md`](firmware/README.md)):
- Al arrancar, PWM desconectado: no recuerda calibración ni movimiento. `target` y `follow` se rechazan hasta calibrar todos los dedos.
- Nunca sale del rango calibrado; rampa con tope de 1 rango/s.
- **Corte por corriente:** más del umbral (filtrado) durante 100 ms → afloja todo y queda en `fault`.
- **STOP:** se engancha al primer flanco; para seguir hay que soltarlo y mandar `release`.
- **Watchdog:** 1 s sin mensajes válidos → afloja todo.
- Al aflojar, desenrolla hasta abierto y recién 500 ms después desconecta el PWM.

### 4.6 Visión

- MediaPipe Hand Landmarker (modelo local en `frontend/public/models/`), 640×480 a 30 Hz.
- Cierre por dedo a partir de los ángulos de flexión, normalizado con la calibración del paciente y suavizado con filtro One Euro.
- Si la mano no se ve, la confianza baja o la cámara se traba (100 ms sin cuadros), el dato se invalida y la sesión no le pide nada nuevo al guante.
- Es una **estimación**, no un goniómetro.

### 4.7 Motor de sesión

Motor determinista en TypeScript (`frontend/src/engine/`), sin reloj propio, testeado con el simulador.

```
 PRESENTAR ──> INTENTO (servos en follow) ──llegó?──sí──> SOSTENER ──> REGISTRAR
                    │                           no
                    │                           ▼
                    │                    ASISTENCIA (target, velocidad baja)
                    └──── corriente / STOP / cámara perdida ──> PAUSA (aviso por voz)
```

- **Plan por defecto:** mano abierta, gancho, mesa, puño recto y puño completo, 3 repeticiones cada una (15 intentos). La pinza pulgar–índice es un plan aparte, opcional.
- La asistencia arranca por tiempo o cuando el paciente deja de progresar.
- **Evaluación:** con la mano relajada, cierra cada dedo lento y rápido y registra corriente vs. posición, restando la fricción del guante vacío medida en la calibración.

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

SQLite en `backend/data/rehab.db`: perfil, calibraciones, sesiones, intentos con trazas, evaluaciones y transcripciones de voz. Exportable a JSON y CSV desde la vista del terapeuta. Los datos de ejemplo de `make demo-seed` (11 sesiones en 3 semanas, paciente simulado que mejora de severo a leve) llevan `is_demo` y se marcan en la UI.

### 4.10 Pendiente

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
| **Evaluación** | Con la mano relajada, el guante cierra cada dedo despacio y después rápido | Resistencia de cada dedo según la velocidad |
| **Espejo** (no construido) | Una mano sana frente a la cámara controla el guante | Nada: es para practicar y para la demo |

**Posiciones** (ejercicios reales de terapia de mano):
- **Deslizamiento de tendones:** mano abierta, gancho, puño completo, mesa, puño recto.
- **Oposición del pulgar:** tocar con el pulgar la punta de cada dedo (inspirado en el test de Kapandji).
- **Pinza:** pulgar e índice.

**Feedback que se retira** (no construido): en modo rehabilitación, la ayuda del guante y las luces se reducen de a poco (por ejemplo, del 100% de los intentos al 50%). El feedback constante genera dependencia.

---

## 6. Métricas

Por dedo y por intento:

- **Rango activo:** cuánto cierra el dedo solo (0–100%). Es la versión aproximada de lo que el terapeuta mide con un goniómetro.
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
| Lesión medular cervical | Asistencia para cerrar la mano en tareas diarias |
| Esclerosis múltiple, parálisis cerebral | Seguimiento de la rigidez en el tiempo |

**Telerrehabilitación:** el paciente practica en casa y el terapeuta ve el dashboard a distancia. Gemini genera un resumen semanal para el terapeuta.

---

## 8. Demo y pitch

El guion detallado (6 minutos, con qué decir en cada paso y cómo recuperarse si falla la cámara, el guante o Gemini) está en [`docs/DEMO.md`](docs/DEMO.md). Todo lo que fuerce resistencia o STOP se muestra con el simulador, nunca con la mano de una persona.

1. Un integrante se pone el guante con la mano relajada. La mano virtual pide un puño, el integrante intenta a medias y el guante completa el movimiento.
2. **Momento clave:** el integrante pone el índice rígido a propósito. En pantalla sube la corriente, **el guante se detiene solo** y la voz dice "detecto resistencia en el índice, paramos acá". Muestra la medición clínica y la seguridad a la vez.
3. Dashboard con la evolución entre sesiones (datos de prueba marcados como tales).
4. Si se puede, hablar 10 minutos con un terapeuta ocupacional o fisiatra antes del evento y meter una frase suya en el video.

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
| Integración | Un dedo de punta a punta: calibrar, `follow`, asistencia, corte por corriente | Pendiente. **Hito: un dedo cerrando con el servo antes de la medianoche del sábado** |
| Pitch | Ensayar `docs/DEMO.md`, video de Devpost | Pendiente |

**Orden:** primero **un dedo + un servo + la cámara de punta a punta**. Después los otros cuatro.

### Riesgos

- **La mecánica es lo más difícil:** fricción del hilo, anclajes que se sueltan, guante que se corre. Probar con un solo dedo lo antes posible.
- **Servos:** ya los tenemos (SG92R, MG90S, 2× S51 y uno negro sin identificar). Falta medir el negro y confirmar que los 5 entran en sus alojamientos.
- **Recorrido del hilo:** 31 mm por media vuelta puede no alcanzar para un puño completo. Medir con un dedo antes de imprimir los carretes definitivos.
- **Cámara con dedos tapados:** probar la posición de la webcam temprano.
- **Firmware nunca probado en una placa:** hacer el banco de pruebas temprano, con el guante sin poner.
- Si la mecánica falla, la app con el simulador (o con la cámara real y el guante simulado) sigue siendo una demo que funciona sola.
