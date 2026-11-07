"""Piezas imprimibles del guante robótico: módulo de muñeca con 5 servos.

El módulo va debajo de la muñeca (lado de la palma), sujeto con dos correas:
una alrededor de la mano y otra del antebrazo. Es rígido y abarca la muñeca,
así que la mantiene recta: el largo de cada hilo no cambia aunque el brazo se
mueva. Los 5 carretes están a la misma altura, justo debajo de la tapa; cada
hilo sale horizontal y tangente a su carrete por arriba del frente, y sube
unos 10° hasta la palma, donde corre pegado a la piel por guías cosidas al
guante hasta la punta del dedo. Sin fundas ni tubos.

Genera los STL en hardware/stl/. Correr desde la raíz del repo con:
    /Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd hardware/cad/piezas.py

Medidas en mm. Ejes de la base: +X hacia los dedos, +Y lado del pulgar
(mano derecha), +Z arriba. Todas las piezas salen en orientación de impresión.

IMPORTANTE: las medidas del servo son las típicas del micro servo 9g / SG90 /
MG90S. Medir el servo real y ajustar los parámetros antes de imprimir.
Para mano izquierda: espejar la base y la tapa en el slicer.
"""
import math
import os

import FreeCAD as App
import Mesh
import Part

V = App.Vector
OUT = os.path.join(os.getcwd(), "hardware", "stl")
os.makedirs(OUT, exist_ok=True)

# --- Servo (medir y ajustar) -------------------------------------------------
# Servos que tenemos: TowerPro SG92R, 2x Smraza S51 (9g), Miuzei MG90S y uno negro
# un poco más grande (sin identificar, MEDIR). Cuerpos de 22,2-23 x 11,8-12,6 mm.
# El alojamiento es universal: hueco de 23,6 x 13,2 y agujeros alargados.
SERVO_L, SERVO_W = 23.6, 13.2      # hueco universal para el cuerpo
SERVO_HOLE_PITCH = 27.8            # distancia entre los agujeros de las orejas (nominal)
HOLE_SLOT = 1.6                    # agujeros alargados ±0,8 mm: entran todos los modelos
SERVO_SHAFT_OFFSET = 5.5           # el eje está corrido del centro del cuerpo hacia +X
BODY_BELOW_TABS = 15.9             # cuánto cuelga el cuerpo debajo de las orejas
SPOOL_ABOVE_DECK = 12.3            # cuerpo sobre las orejas (6,8) + eje (4) + brazo en cruz (1,5)

# --- Carrete e hilo ----------------------------------------------------------
SPOOL_CORE_R = 10.0                # radio de enrollado: ~31 mm de hilo cada 180°
SPOOL_FLANGE_R = 11.0             # deja 1,5 mm de paso a los hilos de la fila de atrás
SPOOL_FLANGE_T, SPOOL_CORE_H = 1.6, 5.0
THREAD_HOLE_R = 1.0

# --- Base --------------------------------------------------------------------
# Física del enrollado: el hilo tiene que salir del carrete EN SU PLANO (ángulo
# de desvío casi 0°). Si sale inclinado, se sube al ala del carrete, enrolla mal
# y carga de costado el eje del servo. Por eso:
#  - los 5 carretes están a la MISMA altura, justo debajo de la tapa;
#  - cada hilo sale horizontal, tangente a su carrete, por el frente;
#  - desde el frente sube unos 10° hasta la guía de la palma (curva mínima).
# Para que 5 carretes de Ø22 entren en 80 mm de ancho van en zigzag: 3 adelante
# y 2 atrás. Los hilos de atrás pasan por el hueco entre los carretes de adelante.
WALL = 2.5
FLOOR = 2.0
X_BACK, X_FRONT = -80.5, 0.0
Y_PINKY, Y_THUMB = -40.0, 40.0     # apenas más ancho que la muñeca
DECK_TOP = FLOOR + BODY_BELOW_TABS + 1.0
# (eje x, eje y, lado de la tangente, dedo): el hilo sale por y = eje_y + lado * radio
# (eje x, eje y, lado, dedo, hueco extra en mm para el cuerpo)
# El pulgar tiene un hueco 1,5 mm más grande para el servo negro sin identificar.
SERVOS = [
    (-20.0, 25.0, +1, "pulgar"),     # sale por y = 35
    (-54.0, 2.5, +1, "indice"),      # sale por y = 12,5 (hueco entre carretes de adelante)
    (-20.0, 0.0, +1, "medio"),       # sale por y = 10
    (-54.0, -22.5, +1, "anular"),    # sale por y = -12,5 (hueco)
    (-20.0, -25.0, +1, "menique"),   # sale por y = -15
]
THREAD_Z = DECK_TOP + SPOOL_ABOVE_DECK + SPOOL_FLANGE_T + SPOOL_CORE_H / 2
WALL_TOP = math.ceil(DECK_TOP + SPOOL_ABOVE_DECK + 2 * SPOOL_FLANGE_T + SPOOL_CORE_H + 1.0)
LID_T = 6.0                        # tapa cóncava: apoyo de la muñeca
WRIST_R = 45.0                     # radio de la curva de la muñeca
POSTS = [(-75.0, 34.5), (-75.0, -34.5), (-34.0, 34.5), (-34.0, -34.5)]   # integradas a las paredes
BIG_POCKET = {"pulgar": 1.5}


def exit_ys():
    return [sy + side * SPOOL_CORE_R for _, sy, side, _ in SERVOS]


def box(x0, x1, y0, y1, z0, z1):
    return Part.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0))


def cyl(r, h, cx=0.0, cy=0.0, z0=0.0):
    return Part.makeCylinder(r, h, V(cx, cy, z0))


def x_cyl(r, length, x0, y, z):
    return Part.makeCylinder(r, length, V(x0, y, z), V(1, 0, 0))


def y_cyl(r, length, x, y0, z):
    return Part.makeCylinder(r, length, V(x, y0, z), V(0, 1, 0))


def export(shape, name):
    shape = shape.removeSplitter()
    mesh = Mesh.Mesh()
    mesh.addFacets(shape.tessellate(0.08))
    path = os.path.join(OUT, name + ".stl")
    mesh.write(path)
    bb = shape.BoundBox
    print(f"{name}: {bb.XLength:.1f} x {bb.YLength:.1f} x {bb.ZLength:.1f} mm, "
          f"{shape.Volume / 1000:.1f} cm3 -> {path}")


# --- 1. Módulo de muñeca -----------------------------------------------------
def soporte_servo(sx, sy, extra=0.0):
    """Soporte individual: un tubo rectangular que va del piso a la cubierta.
    El cuerpo del servo entra desde arriba y las orejas apoyan arriba del tubo."""
    bcx = sx - SERVO_SHAFT_OFFSET
    L, W = SERVO_L + extra, SERVO_W + extra
    outer_l = SERVO_HOLE_PITCH + 2 * 3.2
    outer_w = W + 2 * 2.0
    s = box(bcx - outer_l / 2, bcx + outer_l / 2, sy - outer_w / 2, sy + outer_w / 2, FLOOR - 0.1, DECK_TOP)
    s = s.cut(box(bcx - L / 2, bcx + L / 2, sy - W / 2, sy + W / 2, 0, DECK_TOP + 1))
    # ventana abajo para sacar el cable del servo
    s = s.cut(box(bcx - L / 2 - 5, bcx - L / 2 + 0.1, sy - 3, sy + 3, FLOOR, FLOOR + 7))
    for hx in (-SERVO_HOLE_PITCH / 2, SERVO_HOLE_PITCH / 2):
        x = bcx + hx
        for dx in (-HOLE_SLOT / 2, HOLE_SLOT / 2):
            s = s.cut(cyl(0.9, 12, x + dx, sy, DECK_TOP - 10))
        s = s.cut(box(x - HOLE_SLOT / 2, x + HOLE_SLOT / 2, sy - 0.9, sy + 0.9, DECK_TOP - 10, DECK_TOP + 1))
    return s


def base():
    iy0, iy1 = Y_PINKY + WALL, Y_THUMB - WALL
    s = box(X_BACK, X_FRONT, Y_PINKY, Y_THUMB, 0, WALL_TOP)
    s = s.cut(box(X_BACK + WALL, X_FRONT - WALL, iy0, iy1, FLOOR, WALL_TOP + 1))
    for sx, sy, _, finger in SERVOS:
        s = s.fuse(soporte_servo(sx, sy, BIG_POCKET.get(finger, 0.0)))

    # salidas del frente, todas a la misma altura, justo debajo de la tapa.
    # Cada hilo sale horizontal y tangente a su carrete; entrada y salida abocinadas.
    ys = sorted(exit_ys())
    groups, cur = [], [ys[0]]
    for y in ys[1:]:
        if y - cur[-1] < 4.0:
            cur.append(y)
        else:
            groups.append(cur)
            cur = [y]
    groups.append(cur)
    x0, length = X_FRONT - WALL - 1, WALL + 2
    for g in groups:
        y0, y1 = min(g), max(g)
        if y1 - y0 > 0.1:
            s = s.cut(box(x0, x0 + length, y0, y1, THREAD_Z - 1.2, THREAD_Z + 1.2))
        for y in (y0, y1):
            s = s.cut(x_cyl(1.2, length, x0, y, THREAD_Z))
            s = s.cut(Part.makeCone(1.2, 2.4, 1.4, V(X_FRONT - 1.39, y, THREAD_Z), V(1, 0, 0)))
            s = s.cut(Part.makeCone(2.4, 1.2, 1.0, V(X_FRONT - WALL - 0.01, y, THREAD_Z), V(1, 0, 0)))

    # salida de los cables de los servos hacia la electrónica (sobre la mesa)
    s = s.cut(box(X_BACK - 1, X_BACK + WALL + 1, -24, 24, FLOOR + 3, FLOOR + 13))

    # columnas para los tornillos de la tapa, pegadas a las paredes laterales
    for px, py in POSTS:
        wy = Y_THUMB - WALL if py > 0 else Y_PINKY + WALL
        s = s.fuse(box(px - 3, px + 3, min(wy, wy - 6 * (1 if py > 0 else -1)), max(wy, wy - 6 * (1 if py > 0 else -1)), FLOOR, WALL_TOP))
        s = s.cut(cyl(1.1, WALL_TOP, px, py, FLOOR + 3))
    return s


def lid_top_z(y):
    """Altura de la cara de arriba de la tapa (cóncava) en la posición y."""
    return min(LID_T, LID_T - 4.0 + WRIST_R - math.sqrt(WRIST_R ** 2 - y ** 2))


# --- 2. Tapa (apoyo de la muñeca) -------------------------------------------
def tapa():
    """Cóncava, para que la muñeca calce. Dos pares de orejas para correas de
    velcro de 25 mm: adelante rodea la mano (base del pulgar), atrás el antebrazo.
    Con las dos correas, la base rígida no deja doblar la muñeca."""
    s = box(X_BACK, X_FRONT, Y_PINKY, Y_THUMB, 0, LID_T)
    s = s.cut(x_cyl(WRIST_R, X_FRONT - X_BACK + 2, X_BACK - 1, 0, LID_T - 4.0 + WRIST_R))
    for x0, x1 in ((-31.0, -3.0), (-78.0, -50.0)):
        for y0, y1, sy0, sy1 in ((Y_PINKY - 11, Y_PINKY, Y_PINKY - 8, Y_PINKY - 4),
                                 (Y_THUMB, Y_THUMB + 11, Y_THUMB + 4, Y_THUMB + 8)):
            ear = box(x0, x1, y0, y1, 0, 3.0)
            ear = ear.cut(box(x0 + 1.5, x1 - 1.5, sy0, sy1, -1, 5))
            s = s.fuse(ear)
    for bx, by in POSTS:
        s = s.cut(cyl(1.5, LID_T + 2, bx, by, -1))
    # bordes redondeados donde apoya la piel
    for x in (X_FRONT, X_BACK):
        sgn = 1 if x == X_FRONT else -1
        s = s.cut(box(min(x, x - sgn * 2), max(x, x - sgn * 2) + (1 if sgn > 0 else -1) * 0, Y_PINKY - 12, Y_THUMB + 12, 2.0, LID_T + 1))
    return s


# --- 3. Carrete (se atornilla al brazo en cruz del servo) -------------------
def carrete():
    total = 2 * SPOOL_FLANGE_T + SPOOL_CORE_H
    s = cyl(SPOOL_FLANGE_R, SPOOL_FLANGE_T)
    s = s.fuse(cyl(SPOOL_CORE_R, SPOOL_CORE_H, z0=SPOOL_FLANGE_T))
    s = s.fuse(cyl(SPOOL_FLANGE_R, SPOOL_FLANGE_T, z0=SPOOL_FLANGE_T + SPOOL_CORE_H))
    s = s.cut(cyl(3.2, total + 2, z0=-1))
    for ang in range(0, 360, 90):
        a = math.radians(ang)
        s = s.cut(cyl(0.8, total + 2, 6.5 * math.cos(a), 6.5 * math.sin(a), -1))
    s = s.cut(x_cyl(0.8, 2 * SPOOL_FLANGE_R + 2, -SPOOL_FLANGE_R - 1, 4.8, SPOOL_FLANGE_T + SPOOL_CORE_H / 2))
    return s


# --- 4. Guía de tendón y anclaje (DEFINITIVAS) ------------------------------
# Se cosen al guante del lado de la palma. La base es cóncava (radio 10 mm) para
# calzar en el dedo sin balancearse. El canal tiene entradas abocinadas para que
# el hilo no roce contra una arista. 4 agujeros de 1,4 mm para coser.
FINGER_R = 10.0
GUIDE_BASE_T = 1.8


def guia(anclaje=False):
    s = box(-6, 6, -4.5, 4.5, 0, GUIDE_BASE_T)
    s = s.cut(x_cyl(FINGER_R, 14, -7, 0, 0.8 - FINGER_R))          # apoyo cóncavo
    for sx in (-1, 1):
        for sy in (-1, 1):
            s = s.cut(cyl(0.7, 5, sx * 4.5, sy * 3, -1))
    zc = GUIDE_BASE_T + 1.4                                          # eje del canal
    s = s.fuse(x_cyl(2.4, 8, -4, 0, zc)).fuse(box(-4, 4, -1.5, 1.5, 0.5, zc))
    s = s.cut(Part.makeCone(1.8, THREAD_HOLE_R, 1.2, V(-4.01, 0, zc), V(1, 0, 0)))
    s = s.cut(Part.makeCone(THREAD_HOLE_R, 1.8, 1.2, V(2.81, 0, zc), V(1, 0, 0)))
    s = s.cut(x_cyl(THREAD_HOLE_R, 12, -6, 0, zc))
    if anclaje:
        # tope en la punta: el hilo pasa por el agujero chico y se anuda del otro lado
        s = s.fuse(box(4.0, 5.6, -2.5, 2.5, 0.8, zc + 2.6))
        s = s.cut(x_cyl(0.55, 4, 3, 0, zc))
    return s


def placa_guias(n_guias=16, n_anclajes=6):
    """Todas las guías y anclajes (con repuestos) en una sola placa de impresión."""
    g, a = guia(), guia(anclaje=True)
    shapes = []
    for k in range(n_guias):
        c = g.copy(); c.translate(V((k % 4) * 16, (k // 4) * 13, 0)); shapes.append(c)
    for k in range(n_anclajes):
        c = a.copy(); c.translate(V(4 * 16 + 4 + (k % 2) * 16, (k // 2) * 13, 0)); shapes.append(c)
    return Part.makeCompound(shapes)


def placa_resto(n_anclajes=5):
    """Todo lo que falta imprimir, en una sola placa: módulo, tapa, 5 carretes y
    los anclajes. Las 16 guías van aparte (ya impresas). Cabe en ~170 x 150 mm."""
    gap = 8.0
    shapes = []
    m = base(); m.translate(V(-X_BACK, -Y_PINKY, 0)); shapes.append(m)                 # x 0..80,5  y 0..80
    t = tapa(); t.translate(V(-X_BACK + (X_FRONT - X_BACK) + gap, -Y_PINKY + 11, 0)); shapes.append(t)
    y_row = (Y_THUMB - Y_PINKY) + 11 + 11 + gap + SPOOL_FLANGE_R                       # fila debajo de la tapa
    for k in range(5):
        c = carrete(); c.translate(V(SPOOL_FLANGE_R + k * (2 * SPOOL_FLANGE_R + 4), y_row, 0)); shapes.append(c)
    for k in range(n_anclajes):
        a_ = guia(anclaje=True); a_.translate(V(6 + k * 15, y_row + SPOOL_FLANGE_R + 10, 0)); shapes.append(a_)
    return Part.makeCompound(shapes)


if __name__ in ("__main__", "piezas"):
    for f in os.listdir(OUT):
        if f.endswith(".stl"):
            os.remove(os.path.join(OUT, f))
    export(base(), "modulo_muneca")
    export(tapa(), "tapa")
    export(carrete(), "carrete")
    export(guia(), "guia_tendon")
    export(guia(anclaje=True), "anclaje_punta")
    export(placa_guias(), "placa_guias_x16_anclajes_x6")
    export(placa_resto(), "placa_modulo_tapa_carretes_anclajes")
    print(f"WALL_TOP={WALL_TOP} THREAD_Z={THREAD_Z:.1f} exits={sorted(exit_ys())}")
