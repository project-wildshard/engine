import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { gridSessionBudgetErrors, sessionClosureBudgetErrors, titleClosureBudgetErrors } from '../check-chunks.mjs';

/** Which modules land in which chunk, from the written web bundle: every JavaScript chunk in the build manifest
 *  (`.vite/manifest.json`), its static imports, its bytes, and its modules from its hidden source map's `sources`.
 *  Writes `.vite/chunk-modules.json` (check-chunks, ios-retry-check, js-entry-census) and throws when the title,
 *  grid session or session closure is over its ratchet budget or names a forbidden module. */
export function writeChunkReport(outDir, root) {
  const manifest = JSON.parse(readFileSync(resolve(outDir, '.vite/manifest.json'), 'utf8'));
  /** @type {Record<string, {name: string, moduleIds: string[], rawBytes: number, gzBytes: number, imports: string[]}>} */
  const report = {};
  for (const row of Object.values(manifest)) {
    if (!row.file.endsWith('.js') || Object.hasOwn(report, row.file)) continue;
    const code = readFileSync(resolve(outDir, row.file)), map = resolve(outDir, `${row.file}.map`);
    // a chunk with no source map holds no source module: the bundler's runtime, or a facade that only re-exports
    const { sources = [], sourceRoot = '' } = existsSync(map) ? JSON.parse(readFileSync(map, 'utf8')) : {};
    const moduleIds = sources.map(source => relative(root, resolve(dirname(map), sourceRoot, source)).replaceAll('\\', '/')).sort();
    report[row.file] = { name: row.name ?? '', moduleIds, rawBytes: code.byteLength, gzBytes: gzipSync(code).byteLength,
      imports: (row.imports ?? []).map(key => manifest[key]?.file ?? key) };
  }
  const policy = JSON.parse(readFileSync(resolve(root, 'lint/ratchet.json'), 'utf8'));
  const errors = [...gridSessionBudgetErrors(report, policy.budgets), ...titleClosureBudgetErrors(report, policy.budgets), ...sessionClosureBudgetErrors(report, policy.budgets)];
  if (errors.length > 0) throw new Error(errors.join('\n'));
  mkdirSync(resolve(outDir, '.vite'), { recursive: true });
  writeFileSync(resolve(outDir, '.vite/chunk-modules.json'), JSON.stringify(report, null, 2));
  return report;
}
