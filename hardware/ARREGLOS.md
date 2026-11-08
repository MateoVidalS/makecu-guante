# Arreglos de hardware pendientes (8/11/2026)

Encontrados probando la app con la placa real, sin guante ni mano. **El software ya
coordina bien con la placa:** lo que manda la app llega en 20–40 ms, al dedo correcto, de
a un motor por vez, y el freno suelta todo en ~140 ms. Lo que falla es físico.

**Los pines no cambian** y no hay que tocar el firmware ni la app.

Antes de tocar cables: **desenchufá la fuente de los servos y el USB.** Todo esto es sin
mano: nunca probar atascos ni fallas con el guante puesto.

## Servos: ahora son los 5 iguales

Los cinco dedos usan el **Smraza S51** (micro servo 9 g, tipo SG90). Antes el pulgar era
un servo negro sin identificar que **no se movía** (no consumía corriente); si ese servo ya
se reemplazó por un S51, ese problema debería estar resuelto. Igual hay que verificarlo
(sección 4).

| Dedo | Pin de señal (naranja) | Servo |
| --- | --- | --- |
| Pulgar | D4 (GPIO4) | Smraza S51 |
| Índice | D13 (GPIO13) | Smraza S51 |
| Medio | D27 (GPIO27) | Smraza S51 |
| Anular | D26 (GPIO26) | Smraza S51 |
| Meñique | D25 (GPIO25) | Smraza S51 |

> **8/11/2026, tarde:** se recablearon los servos con este mapa (antes: pulgar D25, índice
> D26, medio D27, anular D13, meñique D4). Las menciones de pines más abajo son del mapa
> viejo, de cuando se encontraron esos problemas.

Rojo de cada servo a la fila **+**, marrón a la fila **−**. Ojo: en la breadboard las filas
+ y − están invertidas arriba y abajo.

**Después de cambiar servos hay que recalibrar** cada dedo en la app (Calibrar), porque
cambió la posición de los brazos. Con el S51, cada dedo dentro de **~10° a 170°** para no
forzar su tope interno.

---

## 1. Si un servo no se mueve

Antes pasó con el pulgar (D25): la app le mandaba las órdenes bien pero el servo no se
movía ni consumía corriente.

1. **Cables.** Con todo desenchufado: marrón en **−**, rojo en **+**, naranja en su pin
   (tabla de arriba). Que entren firmes y en la fila correcta.
2. **Tensión en el servo.** Enchufá la fuente y medí con el multímetro entre rojo y
   marrón **en el conector del servo**. Tiene que dar ~5 V. Si da 0 V, cambiá el cable o
   la fila de la breadboard.
3. **Intercambio.** Pasá su conector al pin de un dedo que anda (por ejemplo D26):
   - Se mueve ahí → el problema es el cable de señal o el pin.
   - Sigue quieto → **el servo está roto: reemplazarlo.**
   - Al terminar, cada servo a su pin.

## 2. Meñique (D4): consumía ~150 mA quieto

Encendido y sin moverse consumía ~150 mA, cuando un servo quieto y sin carga consume casi
nada: estaba empujando contra algo. **No es el pin**: D4 funciona bien.

1. **Desenganchá el hilo** del carrete. Si el consumo baja a ~20 mA, el hilo o el anclaje
   del dedo están demasiado tirantes o trabados: aflojar o rehacer el anclaje. Si sigue
   alto sin hilo, el servo está forzado o dañado: reemplazarlo.
2. **Brazo (horn).** Que no choque con la caja, el carrete o el soporte en ningún punto.
3. Si el servo se cambió por un S51 nuevo, verificar igual con el hilo puesto: el problema
   puede ser el hilo y no el servo.

> **"D4 se movía sin que lo llamen"** es otra cosa: el firmware viejo encendía los 5
> servos con cualquier orden. Ya está arreglado (firmware nuevo cargado el 8/11). Además,
> en las poses de abrir el guante toma el hilo flojo de todos los dedos a propósito, y un
> servo apagado salta rápido a su posición "flojo" la primera vez que se enciende. Si
> después de todo D4 se mueve cuando se ordena otro dedo, avisar: puede haber una señal
> cruzada.

## 3. Fuente: la actual alcanza (mejorarla es opcional)

El módulo **MB102** de la breadboard da ~0,8 A como máximo. Para eso la app ya tiene el
modo **"un motor a la vez"**: con él nunca se pasa de lo que da la fuente. Así se hicieron
las pruebas que dieron bien. **No hay que comprar nada.** Solo dejar en memo:

- **Setup → "One motor at a time (low-power supply)"** marcado (viene marcado).
- **Calibrar → límite de corriente ~700 mA.**

Lo que no se puede con esta fuente: mover varios dedos al mismo tiempo, y al soltar rápido
los servos terminan un poco tarde (0,6–0,8 s). Para un prototipo está bien.

**Opcional, si algún día quieren más fuerza o mover varios dedos juntos:** lo que limita es
el MB102, no el adaptador. El adaptador **Facmogu** que ya tenemos (3–12 V, 5 A) puede ir
directo a los servos:

1. Ponerlo en **5,0 V y medirlo con el multímetro antes de conectar**: tiene que dar
   4,9–5,2 V. **En 7,5 V (como se usaba con el MB102) quema los servos.**
2. Conexión:
   ```
   Adaptador +5,0 V ──► INA219 (VIN+) ──► INA219 (VIN−) ──► fila + de los servos
   Adaptador  GND   ──────────────────────────────────────► fila − de los servos
                                                              │
   ESP32 GND ─────────────────────────────────────────────────┘  (tierra común)
   ESP32 ◄── USB (laptop). Sin VIN. El MB102 deja de alimentar los servos.
   ```
3. **Capacitor electrolítico de 470 a 1000 µF, de 10 V o más**, sobre el riel cerca de los
   servos, con la **franja (−)** al −. **Al revés puede explotar.**
4. **Cables cortos y gruesos**: la breadboard aguanta mal más de 1–2 A.
5. El adaptador **no limita corriente**: la protección es la de la placa.
6. Después, en memo: límite de corriente **~1500 mA** y se puede desmarcar "One motor at a
   time".

## 4. Verificar después de arreglar

1. **Un solo programa por vez en el USB:** la app en Chrome, o las pruebas de un agente.
   Nunca dos a la vez.
2. **Prueba dedo por dedo** (pedírsela a Claude, con el puerto solo para él): mueve cada
   servo solo y mide la corriente. Esperado:
   - Los 5 se mueven a ojo y consumen al moverse.
   - Quietos y encendidos consumen poco (sin los ~150 mA del meñique).
   - Al ordenar un dedo, **ningún otro se mueve**.
3. **Recalibrar en memo** los 5 dedos (servos nuevos) dentro de ~10–170°.
4. **Prueba completa con la app** (también Claude): sesión de práctica con el paciente
   simulado y los motores reales; tiene que dar todo en verde.
5. Anotar lo que se hizo y lo que se midió en [BANCO.md](BANCO.md).
