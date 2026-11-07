# Impresión

En `hardware/definitivas/` hay dos archivos:

| Archivo | Estado | Qué tiene | Medidas |
|---|---|---|---|
| `1_ya_impreso_guias_x16_anclajes_x6.stl` | **Ya impreso** | 16 guías de tendón + 6 anclajes de punta | 96 × 48 × 5,8 mm |
| `2_falta_imprimir_modulo_tapa_carretes.stl` | **Falta imprimir** | Módulo de muñeca + tapa + 5 carretes | 169 × 132 × 41 mm |

Las piezas sueltas (para reponer una sola) están en `hardware/stl/`.

## Placa 2: módulo, tapa y carretes

- PLA. Relleno 20% para el módulo y la tapa, 100% para los carretes (la mayoría de los slicers deja cambiarlo por pieza; si no, 30% para todo).
- Sin soportes: cada pieza apoya su cara plana en la cama.
- Son ~112 cm³. Si el slicer da más de 4 h (límite del Makerspace), imprimir `hardware/stl/modulo_muneca.stl` solo y después `tapa.stl` + 5 × `carrete.stl`.
- Antes de imprimir: el servo negro (28 × 8 × 28 mm) **no entra** en su alojamiento; falta medirlo para hacerle uno propio.

## Placa 1: guías y anclajes (ya impresa)

## Cuántas se usan

| Dedo | Guías | Anclaje |
|---|---|---|
| Pulgar | 1 (falange proximal) | 1 |
| Índice, medio, anular, meñique | 3 cada uno (palma a la altura del nudillo, falange proximal, falange media) | 1 cada uno |
| **Total** | **13** (+3 de repuesto) | **5** (+1 de repuesto) |

## Impresión

- PLA, 0,2 mm de capa, **100% de relleno** (son chicas y tienen que ser firmes).
- Sin soportes. La base es cóncava: apoyan sobre los bordes y el centro queda como un puente de 6 mm, que cualquier impresora hace bien.
- Si los agujeros para coser (1,4 mm) salen cerrados, abrirlos con una aguja caliente o una mecha de 1,5 mm.
- Revisar que el canal del hilo (2 mm) esté libre: pasar la tanza antes de coser.

## Cómo se cosen

- **Del lado de la palma**, centradas en el dedo, con el canal a lo largo del dedo.
- La base cóncava va contra el dedo.
- **Guías:** en el medio de cada falange, para no molestar al doblar las articulaciones. La de la palma va justo antes del nudillo.
- **Anclaje:** en la punta del dedo, con el tope hacia la uña. El hilo entra por el canal, pasa por el agujero chico del tope y se anuda del otro lado (dos o tres nudos, con una gota de pegamento).
- Hilo de coser resistente o tanza fina, 3 o 4 pasadas por agujero. El anclaje es el que más fuerza aguanta: coserlo más firme.

## Hilo (tendón)

Tanza de nylon de 0,5–0,8 mm o hilo encerado. Tiene que pasar suelto por el canal de 2 mm.
