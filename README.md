# MakeCU — Guante sensorial para rehabilitación del agarre

**Track:** Healthcare
**Challenges que se suman:** Touchtronix (SensX25), Trace (PCB custom), MLH Gemini API, Zelos, Notability (opcional)

---

## 1. La idea

El guante mide con qué presión agarra la persona cada objeto y le indica cuándo la presión es la adecuada para levantarlo:

- **Por dedo:** una luz muestra si la presión de ese dedo está en el rango.
- **Por voz:** un asistente da feedback ("ahí vas bien", "aflojá un poco") y conversa entre intentos ("¿cómo te sentiste?").
- **Datos:** todo queda grabado para mostrar la evolución de la persona: qué tan rápido llega a la presión objetivo de cada objeto, cuánto se pasa y qué tan estable sostiene.

**Problema clínico.** Una persona con poca sensibilidad en la mano no siente su propio agarre. Entonces aprieta de más, se fatiga y rompe cosas, o aprieta de menos y se le caen los objetos. El guante le devuelve esa información por otros canales: la vista, el oído y la vibración. Sirve para dos tipos de pacientes:

- **Crónicos:** el guante es una asistencia permanente.
- **En recuperación:** el guante es una herramienta de reentrenamiento y de medición del progreso.

---

## 2. El sensor: Touchtronix SensX25

Fuente: material oficial de Touchtronix (Technical Guide, README, `sensx25.py`) y drivers públicos en GitHub (`TouchTronix-Robotics`).

| Parámetro | Valor |
|---|---|
| Elementos | 25 taxeles, matriz 5×5 (película delgada) |
| Dimensiones | 15,3 × 21 × 6,35 mm, sin agujeros de montaje |
| Qué mide | Solo fuerza **normal**, no mide shear |
| Kit | Sensor + adaptador USB-UART FTDI FT232 con conector de 4 pines |
| Alimentación | Por USB (bus-powered) |
| Frame rate | ~100 Hz, streaming continuo desde que se enciende |
| Serial | 921600 baud, 8N1, sin control de flujo |
| Frame | 53 bytes: `FF FF` + 25 × `uint16` big-endian + CRC-8/MAXIM |
| Throughput | ~5,3 kB/s por sensor |
| Configuración | Modbus RTU, dirección 1, registro `0x6005` |

### Modos de salida

| Modo | Rango por píxel | Notas |
|---|---|---|
| `pressure` (de fábrica) | 0–534 | Unidades arbitrarias |
| `adc` | 0–3945 | ADC de 12 bits menos un offset de 150; ~7× más resolución |

- El modo **queda guardado al apagar**. Hay que devolver el sensor en modo `pressure`.
- **No hay calibración a newtons**: las lecturas son relativas.

### Comportamiento

- Cada píxel tiene un **umbral de activación**: un toque leve da 0.
- Valores de referencia de la guía: dedo suave, pico ~33; dedo firme, pico ~479; objeto rígido, satura en 534.
- La saturación es por píxel. Con carga alta, el total **subestima** la fuerza.
- Un dedo cubre casi todo el array.

### Gotchas de software

- La grilla llega **rotada 90° antihorario** y se corrige con `np.rot90(grid, -1)`. `sensx25.py` lo hace solo; los drivers `sensx` y ROS 2 no.
- Driver `sensx_python`: pasar explícitamente `baud_rate=921600, rows=5, cols=5`. Los valores por defecto son de otro modelo.
- `SensXHub`: maneja hasta 5 SensX25 en un solo hub (canales A–E, headers `0xAAAA`–`0xEEEE`).
- ROS 2 (`sensx_ros2`): `rows:=5 cols:=5` son obligatorios, si no **falla en silencio**. Usar `max_value:=534`.
- `sensx25.py` solo está probado en Windows.

### Features derivadas

Carga total, píxeles activos y centro de presión (CoP) con resolución sub-píxel:

$$F = \sum_i p_i, \qquad r_c = \frac{\sum_i p_i\, r_i}{\sum_i p_i}, \qquad c_c = \frac{\sum_i p_i\, c_i}{\sum_i p_i}$$

Si el CoP se desplaza durante un agarre, el objeto se está **deslizando**. Es la forma de inferir el shear que el sensor no mide directamente.

---

## 3. Arquitectura de hardware

### Plan A (el más seguro): Raspberry Pi + hub USB

```
5× SensX25 ──(FT232 c/u)──> hub USB ──> Raspberry Pi ──> 5× LED WS2812 (GPIO)
                                              │
                                              └──> laptop: voz, LLM, dashboard
```

- Cada kit trae su FT232, que aparece como `/dev/ttyUSB0…4`.
- Ancho de banda total: ~27 kB/s, sin problema.
- La Pi maneja los LEDs directo; para esto no hace falta el ESP32.
- Usa el software oficial sin tocar el hardware.
- Contra: 5 cables del guante a la muñeca. Se resuelve con un brazalete.

### Plan B (inalámbrico): ESP32 leyendo el UART directo

- Saltea el FT232: el conector de 4 pines va al UART del ESP32.
- Límite de UARTs: un ESP32-S3 tiene ~3 libres (con USB nativo para consola), así que **2 placas** cubren 5 dedos. Un ESP32-C3 tiene 2, así que hacen falta **3 placas**.
- Envía por WiFi o ESP-NOW solo la fuerza y el CoP por dedo, no los frames completos.
- Es la base natural para la PCB del challenge de Trace.

**Antes del Plan B hay que confirmar con Touchtronix:**
1. **Pinout y voltaje lógico** del conector de 4 pines. Si el TX es de 5 V, puede dañar un GPIO de 3,3 V.
2. **Si se puede usar el sensor sin el adaptador.** El hardware prestado se devuelve en el mismo estado: no cortar cables.

**Recomendación:** demo funcionando con el Plan A el sábado; migrar al Plan B solo si sobra tiempo y hay confirmación del pinout.

### Montaje en el dedo

La guía exige una **base rígida y plana**, y la yema del dedo no lo es.

- Hacer un **dedal impreso en 3D** con una placa plana para el sensor.
- Poner una **capa fina de silicona o goma** encima: reparte la carga y suaviza el CoP.
- El sensor va al ras, no hundido.
- Hacer **alivio de tensión** del cable en la muñeca (cinta o precinto).
- Hacer la **capacitación del Makerspace temprano** (Mudd 254). Impresión: 1 impresora por equipo, máximo 4 h.

### Feedback

| Canal | Implementación | Por qué |
|---|---|---|
| Luz por dedo | WS2812: azul = falta, verde = en rango, rojo = te pasaste | Feedback visual inmediato |
| Vibración | Motor en muñeca o antebrazo | Sustitución sensorial en piel con sensibilidad conservada |
| Voz | Frases cortas + LLM entre intentos | Guía y conversación |

---

## 4. Software

### Definir la "presión adecuada"

El sensor no da newtons y no sabe cuánto pesa el objeto. Opciones, de más simple a más sólida:

1. **Rango por objeto:** el terapeuta (o el equipo) agarra el objeto y ese agarre define el rango objetivo. Es lo más rápido para la demo.
2. **Detección de deslizamiento:** si el CoP se mueve, falta fuerza.
3. **IMU en la muñeca:** detecta cuándo el objeto se levantó. La fuerza mínima para levantarlo, más un margen, es el objetivo.

### Voz: separar tiempo real de conversación

- **Tiempo real** ("bien", "un poco más", "aflojá"): reglas fijas con frases pregrabadas o TTS. Un LLM tiene demasiada latencia para esto.
- **Entre intentos y resumen de la sesión:** un LLM (Gemini API, que suma el premio MLH). Preguntas como "¿cómo te sentiste?", "hoy llegaste al objetivo 30% más rápido".

### Registro y dashboard

Se graba cada intento con timestamp, objeto, fuerza y CoP por dedo. El dashboard muestra la evolución por sesión y por objeto. En desarrollo, se puede usar Zelos para ver los datos en vivo.

---

## 5. Métricas de evolución

Por cada intento:

- **Tiempo hasta el objetivo** $t_{\text{obj}}$: cuánto tarda en entrar al rango.
- **Exceso de fuerza:**

$$\text{overshoot} = \frac{F_{\max} - F_{\text{obj}}}{F_{\text{obj}}}$$

- **Estabilidad:** variabilidad de la fuerza mientras sostiene, $\sigma_F$ durante el hold.
- **Eventos de deslizamiento:** desplazamientos del CoP.
- **Coordinación entre dedos.**

### Margen de seguridad

En la literatura del control del agarre (Johansson y Westling), una persona sana aprieta apenas por encima del punto de deslizamiento:

$$SM = \frac{F_{\text{agarre}} - F_{\text{desliz}}}{F_{\text{agarre}}}$$

Los pacientes con déficit sensitivo tienen un $SM$ alto y tardan más en estabilizar la fuerza. Si $SM$ y $t_{\text{obj}}$ bajan sesión a sesión, se está midiendo lo que miraría un terapeuta.

> Comunicarlo como "inspirado en la literatura de control del agarre", **no** como "validado clínicamente".

---

## 6. El ángulo de Healthcare

### Pacientes

| Población | Uso del guante |
|---|---|
| **ACV con déficit sensitivo** (protagonista) | Reentrenar la regulación del agarre; mucha literatura |
| Neuropatía periférica (diabetes, quimioterapia) | Asistencia permanente en la vida diaria |
| Lesión de nervio o post-cirugía de mano | Reeducación sensitiva mientras vuelve la sensibilidad |
| Esclerosis múltiple, Parkinson | Sobre-escalado de fuerza, agarre inestable |
| Usuarios de prótesis de mano (visión a futuro) | Feedback sensitivo para una mano que no siente |

Para el pitch: **un protagonista** (paciente post-ACV) y el resto como expansión.

### Dos modos

- **Modo rehabilitación:** el feedback se retira de a poco (por ejemplo, del 100% de los intentos al 50%). Es un principio de aprendizaje motor: el feedback constante genera dependencia y el paciente no reaprende.
- **Modo asistencia:** feedback permanente, para pacientes crónicos.

### Batería de tareas de la vida diaria

Un set fijo de objetos con su rango objetivo, repetible para medir la evolución:

- Vaso de plástico con agua (si aprietas de más se aplasta, si aprietas de menos se cae)
- Huevo
- Frutilla
- Llave

### Telerehabilitación

El paciente practica en casa y el terapeuta ve el dashboard a distancia. El LLM genera un **resumen semanal para el terapeuta**. Ataca un problema real: la rehabilitación necesita muchas horas de práctica y no hay terapeutas para tantas.

---

## 7. Demo y pitch

- **Momento clave:** el vaso de plástico con agua. Primero sin feedback (se aplasta o se cae), después con el guante, en verde y estable.
- Mostrar el dashboard con la evolución entre intentos.
- Si se puede, hablar 10 minutos con un terapeuta ocupacional o fisiatra antes del evento, y meter una frase suya en el video.

### Video de Devpost (3 min): cubrir cada criterio

| Criterio | Qué mostrar |
|---|---|
| Problem solving | Paciente post-ACV, el problema del agarre, la telerehabilitación |
| Innovation | Sustitución sensorial + feedback que se retira + métricas clínicas |
| Technology | 5 sensores táctiles, detección de deslizamiento por CoP, LLM de voz, PCB |
| Design | Dedales, colores claros, vibración en piel sana |
| Completion | Demo en vivo con el vaso de agua |

---

## 8. Challenges a sumar

| Challenge | Cómo entra | Qué hace falta |
|---|---|---|
| **Touchtronix** | Uso central del SensX25 | Taggear en Devpost |
| **Trace** | PCB del guante: ESP32 + LEDs + IMU + batería + conectores | Diseño en Trace, ERC/DRC, BOM, Gerbers, vista mecánica. Al menos un estudiante de EE. Código `MAKECU-X-TRACE-26` |
| **MLH Gemini API** | Asistente de voz y resúmenes | Usar la Gemini API |
| **Zelos** | Visualizar los sensores en desarrollo | Plan Academic con mail universitario |
| **Notability** (opcional) | Documentar el proceso | Taggear, 2+ capturas, 1–2 frases. Código `MAKECU` |

---

## 9. Preguntas para confirmar el día del evento

1. ¿Touchtronix entrega el **hub**? ¿Cuántos sensores por equipo?
2. ¿Cuál es el **pinout y el voltaje lógico** del conector de 4 pines?
3. ¿Se puede usar el sensor **sin el FT232**, con cables propios?
4. ¿Cuáles son los **criterios del challenge** de Touchtronix? (El PDF del challenge no es público.)
5. ¿Hay **motores de vibración** e **IMU** en el inventario de CURC o MLH?

### Pedido de hardware (ventanas CURC)

Sáb 11–13, sáb 17–19, sáb 23–01, dom 8–10. Pedir temprano los LEDs WS2812, el motor de vibración, la IMU y el hub USB.
