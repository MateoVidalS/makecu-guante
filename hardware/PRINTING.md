# Printing

`hardware/definitivas/` contains two files:

| File | Status | Contents | Size |
|---|---|---|---|
| `1_ya_impreso_guias_x16_anclajes_x6.stl` | **Already printed** | 16 tendon guides + 6 fingertip anchors | 96 × 48 × 5.8 mm |
| `2_falta_imprimir_modulo_tapa_carretes.stl` | **Still to print** | Wrist module + lid + 5 spools | 169 × 132 × 41 mm |

The individual parts (to reprint a single one) are in `hardware/stl/`.

## Plate 2: module, lid and spools

- PLA. 20% infill for the module and lid, 100% for the spools (most slicers let you change it per part; otherwise, 30% for everything).
- No supports: each part rests its flat face on the bed.
- About 112 cm³. If the slicer reports more than 4 h (the Makerspace limit), print `hardware/stl/modulo_muneca.stl` alone and then `tapa.stl` + 5 × `carrete.stl`.
- Before printing: the black servo (28 × 8 × 28 mm) **doesn't fit** its housing; it still needs measuring to get a housing of its own.

## Plate 1: guides and anchors (already printed)

## How many are used

| Finger | Guides | Anchor |
|---|---|---|
| Thumb | 1 (proximal phalanx) | 1 |
| Index, middle, ring, pinky | 3 each (palm at knuckle level, proximal phalanx, middle phalanx) | 1 each |
| **Total** | **13** (+3 spare) | **5** (+1 spare) |

## Print settings

- PLA, 0.2 mm layers, **100% infill** (they're small and must be rigid).
- No supports. The base is concave: they rest on the edges and the center becomes a 6 mm bridge, which any printer handles well.
- If the sewing holes (1.4 mm) come out closed, open them with a hot needle or a 1.5 mm drill bit.
- Check that the thread channel (2 mm) is clear: run the fishing line through before sewing.

## How they're sewn on

> These instructions are for the earlier palm-side fabric glove. Since Nov 8 the guides and
> anchors go on the **back** of the bare hand, attached with skin-safe tape (README §3 and
> [`docs/plan/16-bare-hand.md`](../docs/plan/16-bare-hand.md)).

- **On the palm side**, centered on the finger, with the channel running along the finger.
- The concave base goes against the finger.
- **Guides:** in the middle of each phalanx, so they don't get in the way when the joints bend. The palm one goes just before the knuckle.
- **Anchor:** at the fingertip, with the stop toward the nail. The thread enters through the channel, passes through the stop's small hole and is knotted on the other side (two or three knots, with a drop of glue).
- Strong sewing thread or thin fishing line, 3 or 4 passes per hole. The anchor takes the most force: sew it more firmly.

## Thread (tendon)

0.5–0.8 mm nylon fishing line or waxed thread. It must run freely through the 2 mm channel.
