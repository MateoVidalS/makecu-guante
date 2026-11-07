# WP0 visual QA

Chromium screenshots at 1280 × 720:

- [Light shell](wp0-home-light.png)
- [Dark shell](wp0-home-dark.png)

Playwright also checked both themes at 1440 × 900, reduced motion, 64 px controls,
and no horizontal overflow. The shell keeps visible text labels beside status dots.
Screenshots were visually inspected. Final pages remain with their owning workers.

The table uses WCAG relative luminance against `--surface`. Text needs 4.5:1,
essential graphics need 3:1. Vitest separately checks the shell's text, muted text,
accent focus and button contrast across all three surfaces. Exact design colors are
preserved; semantic colors below 3:1 need labels/outlines or design review before
use as essential chart or hand-state signals. The translucent target is decorative.

| Token | Light ratio | Dark ratio |
| --- | ---: | ---: |
| `text` | 16.52:1 | 14.43:1 |
| `muted` | 6.24:1 | 6.82:1 |
| `accent` | 5.87:1 | 6.54:1 |
| `target` | 3.22:1 | 9.81:1 |
| `active` | 4.57:1 | 6.00:1 |
| `assist` | 2.62:1 | 9.05:1 |
| `reached` | 3.49:1 | 7.84:1 |
| `danger` | 5.62:1 | 5.82:1 |
| `demo` | 4.20:1 | 6.54:1 |
| `finger-thumb` | 4.20:1 | 6.54:1 |
| `finger-index` | 3.00:1 | 9.38:1 |
| `finger-middle` | 5.87:1 | 6.89:1 |

No real camera, microphone, serial port, firmware upload, or human-worn glove was used.
