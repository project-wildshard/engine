// Meta SHARD-COMPAT NB10 (audit B12, B16, B19): a retired shard leaves every test list in the same commit. Dropping a pin
// (`pin-shard.ts --drop`, `pins.ts refresh --drop`) refuses while a file under test/ still names the slug, and names each
// file and line, so the drop and the test edits land as one commit instead of a main red and a follow-up. No retired
// product stays installable for tests (ZONE-SNAPSHOTS ZS7, J507). Node built-ins only: shard-pin.yml runs pin-shard.ts
// before `pnpm install`.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TESTS = 'test';
// The pin files the drop itself edits, or that DEL9 already checks against the catalogue.
const SKIP = new Set(['test/pins/shardfiles.json', 'test/pins/catalogue.json']);
const SOURCE = /\.(?:[cm]?[jt]sx?|json)$/u;

/** One test line that names a slug. */
export interface Naming { readonly path: string; readonly line: number; readonly text: string }

/** The code lines of one file that name `slug` as a whole name (not inside a longer slug); comment lines are skipped. */
export function namingLines(slug: string, path: string, text: string): readonly Naming[] {
  if (!/^[a-z0-9-]+$/u.test(slug)) throw new Error(`not a shard slug: ${slug}`);
  const whole = new RegExp(`(?<![a-z0-9-])${slug}(?![a-z0-9-])`, 'u');
  return text.split('\n').flatMap((row, at) => {
    const code = row.trimStart();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || !whole.test(row)) return [];
    return [{ path, line: at + 1, text: code.slice(0, 160) }];
  });
}

/** Every file under `dir` (relative to `root`) a test run reads as source or data, as a path relative to `root`. */
function testFiles(root: string, dir: string): readonly string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : testFiles(root, path);
    return SOURCE.test(entry.name) && !SKIP.has(path) ? [path] : [];
  });
}

/** Every test line naming one of `slugs`. */
export function testsNaming(slugs: readonly string[], root = '.'): readonly Naming[] {
  if (slugs.length === 0) return [];
  const files = testFiles(root, TESTS).map(path => ({ path, text: readFileSync(join(root, path), 'utf8') }));
  return slugs.flatMap(slug => files.flatMap(({ path, text }) => namingLines(slug, path, text)));
}

/** Throws, naming every file and line, while a test still names a slug being dropped. `ALLOW_PIN_DROP_TEST_NAMES=1` (J381)
 *  prints the lines and goes on, for a test that names the slug on purpose, as an unpinned slug a refusal test expects. */
export function assertTestsDropped(slugs: readonly string[], root = '.', env: NodeJS.ProcessEnv = process.env): void {
  const rows = testsNaming(slugs, root);
  if (rows.length === 0) return;
  const { ALLOW_PIN_DROP_TEST_NAMES: allow } = env;
  if (allow === '1') {
    console.warn(`ALLOW_PIN_DROP_TEST_NAMES=1: dropping ${slugs.join(', ')} while ${rows.length} test line(s) name it:\n${rows.map(row => `  ${row.path}:${row.line}`).join('\n')}`);
    return;
  }
  const shown = rows.slice(0, 40).map(row => `  ${row.path}:${row.line}  ${row.text}`);
  throw new Error(`pin drop refused, nothing written: ${rows.length} test line(s) still name ${slugs.join(', ')} (SHARD-COMPAT NB10:`
    + ` a retired shard leaves every test list in the same commit)\n${shown.join('\n')}${rows.length > 40 ? `\n  ... ${rows.length - 40} more` : ''}\n`
    + 'Drop the slug from each, then run the drop again.');
}
