// oxlint-disable-next-line import/no-nodejs-modules -- The fixture pins only its own historical measurement.
import { mkdirSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep fixture policy under its isolated root.
import { join } from 'node:path';
import { codeLines } from '../../scripts/shard-platform.mjs';

export function legacyLineBasis(root: string, slug: string, files: Readonly<Record<string, string>>, excluded: readonly string[] = []): void {
  mkdirSync(join(root, 'lint'), { recursive: true });
  writeFileSync(join(root, 'lint/legacy-line-basis.json'), JSON.stringify({ schema: 'legacy-line-basis/1', revision: 'a'.repeat(40),
    shards: { [slug]: { source: 'a'.repeat(40), excluded, files: Object.fromEntries(Object.entries(files)
      .filter(([path]) => !excluded.includes(path) && /\.tsx?$/u.test(path) && !path.endsWith('.d.ts') && !path.endsWith('.test.ts'))
      .map(([path, text]) => [path, codeLines(text, path)])) } } }));
}
