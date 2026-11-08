# Arreglos de hardware pendientes (8/11/2026)

Encontrados probando la app con la placa real, sin guante ni mano. **El software ya
coordina bien con la placa:** lo que manda la app llega en 20–40 ms, al dedo correcto, de
a un motor por vez, y el freno suelta todo en ~140 ms. Lo que falla es físico. Hay que
hacer estos arreglos antes de seguir probando con la app y antes de pensar en una mano.

Orden recomendado: **3 (fuente) → 1 (pulgar) → 2 (meñique) → 4 (verificar)**. Con la
fuente buena es más fácil saber si un servo anda o no.

Antes de tocar cables: **desenchufá la fuente de los servos y el USB.**

## Mapa de pines (no cambia)

| Dedo | Pin de señal (naranja) | Servo |
| --- | --- | --- |
| Pulgar | D25 (GPIO25) | Negro, sin identificar |
| Índice | D26 (GPIO26) | TowerPro SG92R |
| Medio | D27 (GPIO27) | MG90S |
| Anular | D13 (GPIO13) | Smraza S51 |
| Meñique | D4 (GPIO4) | Smraza S51 |

Rojo de cada servo a la fila **+**, marrón a la fila **−**.

---

## 1. Pulgar (D25): no se mueve

**Síntoma.** La app le manda las órdenes bien (se ve en la telemetría), pero el servo no
se mueve (confirmado a ojo) y la placa no le mide nada de corriente: 16 mA, lo mismo que
con todo apagado. Los otros cuatro sí consumen al moverse. Más temprano el pulgar sí
consumía, así que lo más probable es algo flojo.

**Cómo encontrar el problema:**
1. **Cables.** Con todo desenchufado: marrón en la fila **−**, rojo en **+**, naranja en
   **D25**. Que entren firmes y en la fila correcta. Ojo: en la breadboard las filas + y −
   están invertidas arriba y abajo.
2. **Tensión en el servo.** Enchufá la fuente y medí con el multímetro entre rojo y
   marrón **en el conector del servo** (no en la fuente). Tiene que dar ~5 V.
   - Da 0 V: está cortado el cable o la fila de la breadboard. Cambiá el cable o la fila.
3. **Intercambio.** Pasá el conector del pulgar al pin del índice (D26) y el del índice al
   D25:
   - El pulgar se mueve en D26 → el problema es el cable de señal o el pin D25.
   - El pulgar sigue quieto en D26 → **el servo está roto: reemplazarlo.**
   - Al terminar, dejá cada servo en su pin (tabla de arriba).

## 2. Meñique (D4): consume ~150 mA quieto

**Síntoma.** Encendido y sin moverse consume ~150 mA, cuando un servo quieto y sin carga
consume casi nada. Está empujando contra algo. Solo pasa mientras está encendido.

**Cómo encontrar el problema:**
1. **Desenganchá el hilo** del carrete del meñique.
   - Si el consumo baja a ~20 mA → el problema es el hilo o el anclaje del dedo: está
     demasiado tirante o trabado. Aflojarlo o rehacer el anclaje.
   - Si sigue alto sin hilo → el servo está forzado o dañado: reemplazarlo.
2. **Brazo (horn).** Mirá que no choque con la caja, el carrete o el soporte en ningún
   punto del recorrido.

> **Nota:** esto no es lo mismo que "D4 se mueve sin que lo llamen". Eso lo causaba el
> firmware viejo, que encendía los 5 servos con cualquier orden, y ya está arreglado
> (firmware nuevo cargado el 8/11). Además, en las poses de abrir el guante toma el hilo
> flojo de todos los dedos a propósito, y un servo que estaba apagado salta rápido a su
> posición "flojo" la primera vez que se enciende. Si después de los arreglos D4 se mueve
> cuando se ordena otro dedo, avisar: puede haber una señal cruzada.

## 3. Fuente: la del MB102 no alcanza

**Síntoma.** El MB102 (regulador AMS1117) da ~0,8 A como máximo. Con eso:
- Si se mueven varios servos juntos, la placa corta por **sobrecorriente** (al soltar
  rápido pedían 750–926 mA).
- Los servos quedan **atrasados**: al soltar rápido terminan 0,6–0,8 s después de lo que
  manda la placa.

Por eso hoy la app tiene que mover **un motor a la vez**.

**Arreglo: usar el adaptador Facmogu directo al riel de los servos**, que ya tenemos y da 5 A:

1. **Antes de conectar nada**, poné el adaptador en **5,0 V** y **medilo con el
   multímetro**. Es regulable de 3 a 12 V: en 7,5 V (como se usaba con el MB102)
   **quema los servos.** Tiene que dar entre 4,9 y 5,2 V.
2. **Conexión:**
   ```
   Adaptador +5,0 V ──► INA219 (VIN+) ──► INA219 (VIN−) ──► fila + de los servos
   Adaptador  GND   ──────────────────────────────────────► fila − de los servos
                                                              │
   ESP32 GND ─────────────────────────────────────────────────┘  (tierra común)
   ESP32 ◄── USB (laptop). Sin VIN. El MB102 deja de alimentar los servos.
   ```
   - **La tierra tiene que ser común** (GND del ESP32 unido al − de los servos), si no los
     servos no entienden la señal.
   - El **INA219** tiene que quedar en el + de los servos: es el que mide la corriente y
     permite que la placa corte si hay un atasco.
3. **Capacitor electrolítico de 470 a 1000 µF, de 10 V o más**, sobre el riel de los
   servos, cerca de los conectores: la pata con la **franja (−)** al −, la otra al +.
   **Al revés puede explotar.** Evita que la placa se reinicie cuando arrancan varios
   servos (`reset_reason 9` en la app = caída de tensión).
4. **Cables cortos y gruesos** para el + y el −. La breadboard aguanta mal más de 1–2 A:
   mejor una bornera o soldar el riel de los servos.
5. **Cuidado:** el adaptador **no tiene límite de corriente**. La protección es la de la
   placa (corta si pasa del límite durante 100 ms). Nunca probar atascos ni fallas con el
   guante puesto. Todo esto es sin mano.

## 4. Verificar después de arreglar

1. **Un solo programa por vez en el USB:** la app en Chrome, o las pruebas de un agente.
   Nunca dos a la vez, porque se mezclan las órdenes y los resultados.
2. **Prueba dedo por dedo** (pedírsela a Claude, con el puerto solo para él): mueve cada
   servo solo y mide la corriente. Esperado:
   - Los 5 se mueven a ojo y consumen al moverse.
   - Quietos y encendidos consumen poco (sin los ~150 mA del meñique).
   - Al ordenar un dedo, **ningún otro se mueve**.
3. **Prueba completa con la app** (también Claude): sesión de práctica con el paciente
   simulado y los motores reales; tiene que dar todo en verde.
4. **En memo, con la fuente nueva:**
   - **Calibrar → límite de corriente ~1500 mA** (con el MB102 se usaba 700).
   - **Setup → "One motor at a time (low-power supply)"**: se puede desmarcar para que
     vuelvan a moverse hasta 3 dedos juntos, o dejarlo marcado para ir más suave.
5. Anotar lo que se hizo y lo que se midió en [BANCO.md](BANCO.md).

## Qué no hace falta tocar

- **Firmware:** ya está cargado el nuevo (solo enciende los dedos que tiran).
- **App:** coordina bien con la placa; la ayuda va al dedo pedido y solo cuando el
  paciente la pide.
