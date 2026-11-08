// Run from any directory: node frontend/src/mocks/generate-demo.mjs
// This is generated data, not a second story. Keep the reference day fixed for reviewable diffs.
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const endDate = '2026-11-07T10:00:00.000Z';
const generator = new URL(
  '../../../backend/tools/generate_demo.mjs',
  import.meta.url,
);
const story = JSON.parse(
  execFileSync(process.execPath, [fileURLToPath(generator), endDate], {
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
  }),
);
writeFileSync(
  new URL('./demo.generated.json', import.meta.url),
  JSON.stringify({ endDate, story }) + '\n',
);
