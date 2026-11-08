# Banco: tercera sesión (8/11/2026, mañana)

Monitoreo de la placa real desde la laptop mientras se hacían los arreglos de
[ARREGLOS.md](ARREGLOS.md). **Sin tendones y sin guante**: no aprueba ningún paso de
[firmware/BENCH.md](../firmware/BENCH.md). Las pruebas las corrió Claude con
[`firmware/tools/bench_monitor/bench_monitor.py`](../firmware/tools/bench_monitor/bench_monitor.py)
(ver al final), con el puerto COM3 solo para él.

## Armado

El de la segunda sesión de banco (rama `bench/hil-segunda-sesion`), con los **5 dedos con
Smraza S51**. El diagrama está en el informe
[docs/qa/informe-qa-memo.html](../docs/qa/informe-qa-memo.html), sección
*Armado del banco para retomar*.

| Pieza | Conexión |
| --- | --- |
| Fuente | Facmogu en 7,5 V → MB102 (jumper del lado USB sacado) |
| 5 V de los servos | Patita 5V de la tira del medio del MB102 → INA219 `VIN+` → `VIN−` → fila **+** de los servos |
| GND de los servos | Patita GND de la tira del medio del MB102 → fila **−** de los servos |
| ESP32 | USB a la laptop, VIN sin conectar, GND a la fila **−** (tierra común) |
| INA219 (datos) | `VCC`→3V3, `GND`→GND, `SDA`→D21, `SCL`→D22. **Soldado al final de la sesión** |
| Capacitor | 470 µF / 25 V entre la fila + y la fila − |
| Servos | Pulgar D25, índice D26, medio D27, anular D13, meñique D4. Rojo a +, marrón a − |
| STOP (D32) | Sin conectar |
| Firmware | `0.1.0` (`hello` → `{"fingers":5,"limit":1500}`), sin calibración guardada |

## Qué pasó, en orden

| Hora | Qué se hizo | Resultado |
| --- | --- | --- |
| 07:43 | Pulgar (D25), `jog` 60°→120°→90° | 0 mA todo el tiempo. El índice (D26), de control, también 0 mA. No era el pulgar |
| 07:44 | Reinicio | Arranque con **`ina_missing`**: el INA219 estaba desconectado, por eso todo daba 0 mA |
| 07:49–08:00 | Reconexión del INA219 | El reinicio por software (RTS del CP2102) dejó la placa trabada en el arranque **tres veces**: solo imprime `ets Jul 29 2019 12:21:46` y no manda `boot` ni telemetría. Con **EN** o desenchufando el USB arranca bien |
| 08:03 | Barrido de los 5 canales con un solo servo enchufado | Solo D25 consume: reposo 3 mA, moviéndose hasta 69 mA de promedio, picos de 451 mA. **El pulgar anda: era la conexión** (paso 1 de ARREGLOS) |
| 08:04 | Mismo barrido, canal D4 | Picos de 657–712 mA **con la placa en reposo**, sin ningún motor encendido: fue de afuera (un servo enchufado con la fuente prendida) |
| 08:11 | Pulgar, índice y medio, de a uno | Los 3 consumen al moverse (ver tabla). Reposo de los 3: 13 mA (~4 mA por servo) |
| 08:17 | Se enchufó un servo con la fuente prendida | Pico de **1142 mA** con todo quieto; el reposo pasó de 13 a 16 mA. A las 08:17:35, **`ina_missing` en pleno uso**: un cable de datos del INA219 se movió. Apretar EN no lo recuperó hasta reacomodar los cables |
| 08:21 | Ronda de 2 min, `jog` 60°↔120°, de a un servo, `limit` 750 | 9 vueltas, sin eventos. Al terminar, 16 mA en reposo |
| 08:23 | Meñique y pulgar quietos, sosteniendo 90° | **16 mA, igual que en reposo.** El consumo de ~150 mA quieto del meñique (paso 2 de ARREGLOS) no aparece, sin hilo |
| 08:25 | Barrido de 3 min a recorrido completo y velocidad máxima (`target`, ver nota) | 22 recorridos por servo, sin cortes. A las 08:28:39, **`ina_missing` otra vez**, con la vibración de los servos |
| 08:34 | INA219 **soldado**, EN | El sensor vuelve. Barrido de 1 min igual al anterior: 8 recorridos por servo, sin `ina_missing` y sin cortes |

> **Nota:** los barridos de las 08:25 y las 08:34 usaron una calibración de banco de
> **5°–175°** (el máximo que deja el firmware). ARREGLOS.md recomienda **~10°–170°** para el
> S51, para no forzar su tope interno, así que parte de los picos puede ser el servo
> apretando contra el tope. Ningún servo se trabó. La herramienta ahora usa 10°–170° por
> defecto.

## Corrientes medidas (MB102 a través del INA219, sin tendones)

**Dedo por dedo, `jog` 60°→120°→90° (08:11):**

| Dedo | Pin | Moviéndose (promedio máx.) | Pico |
| --- | --- | --- | --- |
| Pulgar | D25 | 92 mA | 431 mA |
| Índice | D26 | 83 mA | 413 mA |
| Medio | D27 | 85 mA | 390 mA |

**Recorrido completo a velocidad máxima, de a un servo, `limit` 750 mA:**

| Dedo | 3 min antes de soldar: promedio / pico | 1 min con el INA219 soldado: promedio / pico |
| --- | --- | --- |
| Pulgar | 188 / 507 mA | 138 / 454 mA |
| Índice | 175 / 504 mA | 132 / 315 mA |
| Medio | 184 / 477 mA | 116 / 376 mA |
| Anular | 165 / 532 mA | 124 / 301 mA |
| Meñique | 197 / 599 mA | 128 / 418 mA |

- Tiempos de un recorrido completo, iguales en los 5 dedos: **ida 1,03–1,04 s**
  (`V_MAX` = 1 rango/s) y **vuelta 0,37–0,38 s** (`V_RELEASE` = 3 rangos/s).
- Con el INA219 soldado las corrientes salen más bajas y parejas. Con la conexión floja
  las lecturas venían infladas, o el falso contacto agregaba consumo.
- Ningún pico llegó al corte de 750 mA. Un solo servo a máxima velocidad pide 300–600 mA
  de pico: el MB102 (~0,8 A) lo aguanta de a uno, no varios juntos.

## Conclusiones

- **Paso 1 (pulgar):** resuelto. El servo en D25 se mueve y consume; el problema era la
  conexión.
- **Paso 2 (meñique):** sin hilo, quieto consume lo mismo que en reposo. Falta verificar
  **con el hilo puesto**, como pide ARREGLOS.
- **Paso 3 (fuente):** sin cambios. Con el MB102 y "un motor a la vez" alcanza para mover
  de a un servo, incluso a velocidad máxima.
- **Paso 4 (verificar):** los 5 se mueven y consumen al moverse, y quietos consumen poco.
  Falta mirar **a ojo** que al ordenar un dedo no se mueva otro (con un solo INA219 no se
  puede medir), recalibrar en memo (~10°–170°) y la prueba completa con la app.
- **INA219:** se desconectó dos veces con el cableado en la breadboard (al tocar cables y
  con la vibración). Soldado, aguantó 1 min de barrido. La caída anterior fue a los
  ~3 min, así que conviene repetir una prueba de 3 min.
- **360°:** no se puede. Los S51 son servos de posición (~180°) y el firmware los limita a
  5°–175°. El `jog` va a 60°/s; el `target` llega a ~165°/s con el rango completo.

## Aprendizajes

1. **Sin INA219, la placa mide 0 mA y no corta por sobrecorriente**, pero el `jog` sigue
   funcionando. `ina_missing` solo aparece al arrancar o cuando se pierde el sensor, y el
   firmware no lo vuelve a buscar hasta reiniciar con **EN**. Después de `ina_missing` en
   pleno uso, el valor de corriente queda congelado en la última lectura.
2. **No reiniciar por software** (RTS del CP2102) con este armado: la placa quedó trabada en
   el arranque tres veces. Usar **EN** o desenchufar el USB. No se encontró la causa.
3. **Desenchufar la fuente de los servos antes de enchufar un servo:** con la fuente
   prendida hubo un tirón de 1142 mA, y al manipular se movieron los cables del INA219.
4. **Soldar el INA219** (o asegurar los cables de datos) antes de usar el guante: en la
   breadboard se suelta con la vibración.
5. **Un solo programa por vez en COM3:** mientras corre el monitor, la app no puede
   conectarse al guante.

## Pendiente

- Barrido de 3 min con el INA219 soldado, en **10°–170°**.
- Meñique con el hilo puesto (paso 2 de ARREGLOS).
- Mirar a ojo que ningún dedo se mueva cuando se ordena otro.
- Recalibrar los 5 dedos en memo y la prueba completa con la app (paso 4 de ARREGLOS).

## Herramienta: monitor de banco (`bench_monitor.py`)

[`firmware/tools/bench_monitor/bench_monitor.py`](../firmware/tools/bench_monitor/bench_monitor.py)
abre el puerto sin reiniciar la placa, manda `ping` cada 300 ms, registra en `bench.log`
cada `info`/`evt`/`err`, un resumen de la telemetría cada 5 s, y avisa si el consumo en
reposo pasa de 80 mA. Si se desenchufa el USB, termina solo. **Solo en el banco.**

```sh
uv run --no-project --with pyserial python firmware/tools/bench_monitor/bench_monitor.py COM3 <carpeta>
```

Las pruebas se piden agregando una línea JSON a `<carpeta>/cmd.jsonl`; cualquier otra
línea JSON se manda tal cual a la placa:

| Comando | Qué hace |
| --- | --- |
| `{"t":"__test_finger","i":0}` | Reposo, `jog` 60°→120°→90° de un dedo, `release`, reposo. Dice si consume al moverse |
| `{"t":"__scan"}` | `__test_finger` de los 5 canales, de a uno (sirve para encontrar en qué pin está un servo) |
| `{"t":"__burnin","seconds":120}` | Ronda de `jog` 60°↔120°, de a un servo, con `limit` 750. Corta ante cualquier evento de seguridad |
| `{"t":"__sweep","seconds":180}` | Recorrido completo a velocidad máxima (`calib` de banco + `target`), de a un servo, `limit` 750. Por defecto 10°–170° |
| `{"t":"__quit"}` | `release` y termina |

Las calibraciones de banco quedan solo en la memoria de la placa: se borran al reiniciar.
Recalibrar en memo antes de usar la app con el guante.
