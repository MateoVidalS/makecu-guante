import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('uses the contract mapping for every closure/pull inversion in engine sources', () => {
  const scan = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? scan(path)
        : path.endsWith('.ts')
          ? [path]
          : [];
    });
  const inversion = new RegExp('\\b' + '1' + '\\s*-\\s*');
  for (const path of scan(join(process.cwd(), 'src/engine'))) {
    expect(readFileSync(path, 'utf8').match(inversion), path).toBeNull();
  }
});
