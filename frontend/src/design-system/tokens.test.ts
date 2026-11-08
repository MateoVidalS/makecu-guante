import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tokens } from '../styles/tokens';
import { contrast } from './contrast';

const css = readFileSync(
  resolve(process.cwd(), 'src', 'styles', 'tokens.css'),
  'utf8',
);
const kebab = (k: string) =>
  k.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
function block(selector: string) {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [
      m[1],
      m[2].toUpperCase(),
    ]),
  );
}

describe('tokens', () => {
  it('keeps tokens.ts colors identical to tokens.css in both themes', () => {
    const light = block(':root {'),
      dark = block(":root[data-theme='dark'] {"),
      media = block(":root:not([data-theme='light']) {");
    for (const [key, value] of Object.entries(tokens.light))
      expect([key, light[kebab(key)]]).toEqual([key, value]);
    for (const [key, value] of Object.entries(tokens.dark)) {
      expect([key, dark[kebab(key)]]).toEqual([key, value]);
      expect([key, media[kebab(key)]]).toEqual([key, value]);
    }
  });

  for (const name of ['light', 'dark'] as const) {
    const t = tokens[name];
    const surfaces = [t.bg, t.surface, t.surface2];
    it(`${name}: text roles reach 4.5:1 on every surface`, () => {
      for (const s of surfaces)
        for (const fg of [
          t.text,
          t.muted,
          t.accent,
          t.activeText,
          t.assistText,
          t.reachedText,
          t.dangerText,
          t.demoText,
          t.cautionText,
        ])
          expect(contrast(fg, s), `${fg} on ${s}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: text on soft tints and filled controls reaches 4.5:1`, () => {
      const pairs: [string, string][] = [
        [t.accent, t.accentSoft],
        [t.text, t.accentSoft],
        [t.activeText, t.activeSoft],
        [t.assistText, t.assistSoft],
        [t.reachedText, t.reachedSoft],
        [t.dangerText, t.dangerSoft],
        [t.demoText, t.demoSoft],
        [t.cautionText, t.cautionSoft],
        [t.text, t.assistSoft],
        [t.text, t.dangerSoft],
        [t.text, t.cautionSoft],
        [t.onAccent, t.accent],
        [t.onAccent, t.accentHover],
        [t.onDanger, t.danger],
        [t.onChrome, t.chrome],
        [t.onBrand, t.brand],
        [t.text, t.surface3],
      ];
      for (const [fg, bg] of pairs)
        expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: control outlines, focus ring and key state fills reach 3:1`, () => {
      for (const s of surfaces)
        for (const fg of [t.borderStrong, t.focusRing, t.danger, t.active])
          expect(contrast(fg, s), `${fg} on ${s}`).toBeGreaterThanOrEqual(3);
    });
  }
});
