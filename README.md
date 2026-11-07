# MakeCU — Guante robótico para rehabilitación de la mano

**Track:** Healthcare
**Challenges que se suman:** MLH Gemini API, Trace (PCB custom), Zelos, Notability (opcional)

---

## 1. La idea

Un guante que **ayuda a mover los dedos** de una mano afectada (por ejemplo, después de un ACV) y **mide cuánto puede moverlos la persona sola**.

- La pantalla muestra una **mano virtual** con la posición que hay que hacer: puño, gancho, pinza.
- El paciente **intenta hacerla** con la mano afectada. Una webcam mide hasta dónde llega cada dedo.
- Si no llega, **el guante completa el movimiento**: servos en el antebrazo tiran de hilos que funcionan como tendones y cierran los dedos.
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

> Esta sección es la **especificación** del software. Está pensada para que otro agente (o integrante) arme el plan de implementación a partir de acá: qué tiene que hacer el sistema, sus partes, las interfaces entre ellas y cómo se valida. No fija la implementación.

### 4.1 Objetivo

Una app web en la laptop que:
1. Le muestra al paciente una **mano virtual** con la posición objetivo.
2. Mide con la **webcam** cuánto cierra cada dedo de la mano afectada.
3. Le pide al **guante** (ESP32 por USB) que complete el movimiento cuando el paciente no llega.
4. Registra cada intento, lo muestra en un **dashboard** y genera resúmenes con **Gemini**.

### 4.2 Componentes

| # | Componente | Dónde corre | Responsabilidad |
|---|---|---|---|
| A | **Firmware del guante** | ESP32-WROOM-32 (Arduino / PlatformIO) | Mover servos, leer el INA219, aplicar los cortes de seguridad, hablar por serie |
| B | **Puente serie** | Navegador (Web Serial API, Chrome) | Conectar con la ESP32, enviar comandos, recibir telemetría |
| C | **Visión** | Navegador (MediaPipe Hand Landmarker, WASM/GPU) | 21 puntos de la mano → % de cierre por dedo |
| D | **Mano virtual** | Navegador (three.js) | Dibujar la mano objetivo y la mano real superpuestas |
| E | **Motor de sesión** | Navegador | Máquina de estados de cada ejercicio, lógica de "ayuda solo lo que falta", métricas |
| F | **Voz** | Navegador (Web Speech API) + Gemini API | Frases fijas en tiempo real; conversación y resúmenes con Gemini |
| G | **Registro y dashboard** | Navegador (IndexedDB o archivo JSON) | Guardar intentos, gráficos de evolución, exportar para el terapeuta |

Todo lo de la laptop puede ser **una sola app web estática** (sin backend), salvo la llamada a Gemini, que necesita la API key. Para el hackathon alcanza con un servidor local mínimo que haga de proxy a Gemini y no exponga la key en el navegador.

### 4.3 Flujo de datos

```
 webcam ──> [C Visión] ──% cierre por dedo (30 Hz)──┐
                                                    ▼
                         [E Motor de sesión] ──objetivo por dedo──> [B Serie] ──USB──> [A Firmware]
                           │      ▲                                     ▲                  │
                           │      └────────telemetría (corriente, ángulos, estado, 50 Hz)──┘
                           ├──> [D Mano virtual]
                           ├──> [F Voz] <──> Gemini
                           └──> [G Registro] ──> dashboard
```

### 4.4 Protocolo serie (laptop ↔ ESP32)

USB a **115200 baud**, líneas de texto terminadas en `\n`, una por mensaje (JSON compacto). Simple de depurar con cualquier monitor serie.

**Laptop → ESP32**

| Mensaje | Ejemplo | Significado |
|---|---|---|
| `target` | `{"t":"target","f":[0.8,0.6,0.6,0.5,0.5],"v":0.5}` | Objetivo de cierre (0–1) para pulgar, índice, medio, anular, meñique; `v` = velocidad máxima (fracción del recorrido por segundo) |
| `follow` | `{"t":"follow","f":[0.3,0.4,0.1,0.2,0.2]}` | Posición actual de los dedos según la cámara: el servo enrolla el hilo flojo hasta ahí sin tirar |
| `release` | `{"t":"release"}` | Aflojar todo (volver a 0) |
| `calib` | `{"t":"calib","i":1,"min":20,"max":150}` | Ángulos de servo para 0% y 100% del dedo `i` |
| `limit` | `{"t":"limit","ma":900}` | Umbral de corriente para el corte |
| `ping` | `{"t":"ping"}` | Keepalive |

**ESP32 → laptop** (telemetría a ~50 Hz, más eventos)

| Mensaje | Ejemplo | Significado |
|---|---|---|
| `tel` | `{"t":"tel","ms":12345,"a":[0.42,0.40,0.35,0.3,0.3],"ma":312,"st":"run"}` | Posición actual de cada servo (0–1), corriente total en mA, estado |
| `evt` | `{"t":"evt","e":"overcurrent","ma":950}` | Evento: `overcurrent`, `stop_button`, `watchdog`, `boot` |

**Reglas de seguridad que el firmware aplica siempre, aunque la laptop diga otra cosa:**
- Nunca mover un servo fuera de su rango calibrado.
- Rampa: el servo no puede cambiar más rápido que `v`, con un tope fijo en el firmware.
- **Corte por corriente:** si la corriente supera `limit` durante más de ~100 ms, aflojar todo y mandar `evt overcurrent`. Queda en estado `fault` hasta un `release` explícito.
- **Botón STOP:** aflojar todo al instante (interrupción), estado `fault`.
- **Watchdog:** si no llega ningún mensaje en 1 s (laptop colgada o cable desconectado), aflojar todo.

### 4.5 Visión: % de cierre por dedo

- MediaPipe Hand Landmarker devuelve 21 puntos 3D por mano.
- Para cada dedo, sumar los ángulos de flexión de sus articulaciones (MCP, PIP, DIP; para el pulgar, MCP e IP) a partir de los vectores entre puntos consecutivos.
- Normalizar con la **calibración del paciente**: mano abierta = 0%, puño = 100% (o el máximo que el guante logra con la mano relajada).
- Suavizar (por ejemplo, filtro One Euro) para que el número no salte.
- Informar una **confianza** por cuadro; si la mano no se ve o la confianza es baja, el motor de sesión no debe pedirle nada nuevo al guante.

Limitaciones conocidas: la profundidad desde una sola cámara es aproximada y los dedos se tapan en el puño. La cámara se monta arriba y de costado. El dato es una **estimación**, no un goniómetro.

### 4.6 Motor de sesión

Máquina de estados por intento:

```
 PRESENTAR ──> INTENTO (paciente solo, N s) ──> llegó? ──sí──> SOSTENER ──> REGISTRAR
                    │                                │
                    │ (servos en "follow")            no
                    │                                ▼
                    │                           ASISTENCIA (target = posición objetivo)
                    │                                │
                    └─────── overcurrent / STOP ─────┴──> PAUSA (aviso por voz) ──> REGISTRAR
```

- **Intento:** los servos solo siguen al dedo (`follow`), sin tirar. Se guarda el máximo cierre logrado sin ayuda.
- **Asistencia:** se manda el objetivo con velocidad baja. Lo que el guante completa es la "ayuda necesaria".
- **Retiro del feedback:** un parámetro de sesión define en qué porcentaje de intentos hay luces y ayuda (por ejemplo, de 100% a 50% a lo largo de las sesiones).
- **Modo evaluación:** con la mano relajada, cerrar cada dedo a velocidad lenta y rápida y registrar la curva corriente vs. posición. Antes, medir el guante vacío para restar la fricción propia.
- **Modo espejo** (extra): el % de cierre de una mano sana se manda directo como `target`.

### 4.7 Métricas por intento

| Métrica | Fuente |
|---|---|
| Cierre activo máximo por dedo (0–100%) | Visión, durante INTENTO |
| Tiempo hasta la posición | Visión |
| Ayuda necesaria (objetivo − cierre activo) | Motor de sesión |
| Corriente pico y media durante la asistencia | Telemetría |
| Resistencia lenta vs. rápida (modo evaluación) | Telemetría − calibración del guante vacío |
| Eventos de seguridad | Telemetría |

### 4.8 Voz y Gemini

- **Tiempo real** ("bien", "un poco más", "paramos acá"): frases fijas con la Web Speech API. Sin LLM: tiene demasiada latencia.
- **Entre intentos y al final de la sesión:** Gemini recibe un resumen estructurado de las métricas (no video ni datos crudos) y devuelve una frase para el paciente o un resumen para el terapeuta.
- **Resumen semanal para el terapeuta:** texto + los gráficos del dashboard.
- Todo lo que dice Gemini se presenta como acompañamiento, no como indicación médica.

### 4.9 Datos

Por sesión: paciente (seudónimo), fecha, calibración, modo. Por intento: posición objetivo, métricas de 4.7, serie temporal reducida (% cierre por dedo y corriente a ~20 Hz) y eventos. Se guarda localmente; exportable a JSON o CSV. Para la demo, sesiones de ejemplo marcadas como tales.

### 4.10 Criterios de aceptación (demo)

1. La mano virtual sigue la mano real con menos de ~150 ms de demora visible.
2. Un `target` llega al servo en menos de 50 ms.
3. Con el índice rígido a propósito, el corte por corriente afloja el guante y la voz lo anuncia.
4. El botón STOP afloja todo en cualquier estado.
5. Desconectar el USB afloja el guante en 1 s como máximo (watchdog).
6. Una sesión completa (5 posiciones × 3 intentos) queda registrada y genera un resumen de Gemini.

### 4.11 Decisiones abiertas (para quien haga el plan)

- Framework de la app (vanilla + Vite, React, etc.).
- Proxy de Gemini: servidor local mínimo vs. otra solución.
- IndexedDB vs. archivos JSON para el registro.
- Filtro de suavizado y umbrales exactos de "llegó a la posición".
- Si se usa Zelos para ver la telemetría durante el desarrollo.

---

## 5. Modos

| Modo | Qué hace | Qué mide |
|---|---|---|
| **Ejercicio** (principal) | Posiciones de terapia. El paciente intenta solo y el guante ayuda lo que falta | Cuánto llega solo cada dedo, tiempo hasta la posición, cuánta ayuda necesitó |
| **Evaluación** | Con la mano relajada, el guante cierra cada dedo despacio y después rápido | Resistencia de cada dedo según la velocidad |
| **Espejo** (extra, si sobra tiempo) | Una mano sana frente a la cámara controla el guante | Nada: es para practicar y para la demo |

**Posiciones** (ejercicios reales de terapia de mano):
- **Deslizamiento de tendones:** mano abierta, gancho, puño completo, mesa, puño recto.
- **Oposición del pulgar:** tocar con el pulgar la punta de cada dedo (inspirado en el test de Kapandji).
- **Pinza:** pulgar e índice.

**Feedback que se retira:** en modo rehabilitación, la ayuda del guante y las luces se reducen de a poco (por ejemplo, del 100% de los intentos al 50%). El feedback constante genera dependencia.

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
| Design | Guante liviano, servos en el antebrazo, seguridad en capas |
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
- Velcro.
- Cables jumper.

### Impresión 3D (Makerspace, Mudd 254)

Piezas en `hardware/`: módulo de muñeca, tapa, carretes, guías y anclajes (ver sección 3). Hacer la **capacitación del Makerspace temprano**. Máximo 4 h por impresión, 1 impresora por equipo.

---

## 11. Plan de trabajo

| Rol | Tarea | Hito |
|---|---|---|
| Mecánica | Guante, guías, anclajes, soporte de servos | **Un dedo cerrando con el servo antes de la medianoche del sábado** |
| Firmware | ESP32: servos, INA219, STOP, protocolo serie | Servo controlado desde la laptop con corte por corriente |
| Visión | MediaPipe, % de cierre por dedo, mano virtual | Mano virtual siguiendo la mano real |
| Voz y pitch | Gemini, dashboard, video | Resumen de sesión generado con datos reales |

**Orden:** primero **un dedo + un servo + la cámara de punta a punta**. Después escalar a los cinco dedos.

### Riesgos

- **La mecánica es lo más difícil:** fricción del hilo, anclajes que se sueltan, guante que se corre. Probar con un solo dedo lo antes posible.
- **Servos:** ya los tenemos (SG92R, MG90S, 2× S51 y uno negro sin identificar). Falta medir el negro y confirmar que los 5 entran en sus alojamientos.
- **Recorrido del hilo:** 31 mm por media vuelta puede no alcanzar para un puño completo. Medir con un dedo antes de imprimir los carretes definitivos.
- **Cámara con dedos tapados:** probar la posición de la webcam temprano.
- Si la mecánica falla, la mano virtual con la cámara sigue siendo una demo que funciona sola.
