// The engine's side rule (multi-repo plan J1/J2, P1 E2), checked on every
// `pnpm check`:
//   client  may import shared, client
//   server  may import shared, server
//   shared  may import shared
//   cook    may import shared, cook
// No DOM in shared/server/cook is enforced by TypeScript: the root
// src/tsconfig.json has no `dom` lib; only the client has its own tsconfig.
// Usage: node src/scripts/check-sides.mjs [src-dir]   (exit 1 on a violation)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOWED = {
  shared: ['shared'],
  server: ['shared', 'server'],
  client: ['shared', 'client'],
  cook: ['shared', 'cook'],
};

const IMPORT = /(?:\bimport|\bexport)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]/g;

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(?:ts|tsx|mts)$/.test(entry)) out.push(path);
  }
  return out;
}

/** @returns {string[]} violations, `file: imports <side> (<specifier>)`. */
export function checkSides(src) {
  const problems = [];
  for (const side of Object.keys(ALLOWED)) {
    let root;
    try { root = statSync(join(src, side)).isDirectory() ? join(src, side) : null; } catch { root = null; }
    if (!root) continue;
    for (const file of files(root)) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(IMPORT)) {
        const spec = match[1] ?? match[2] ?? match[3];
        if (!spec.startsWith('.')) continue;
        const target = relative(src, resolve(dirname(file), spec)).split(sep)[0];
        if (target in ALLOWED && !ALLOWED[side].includes(target)) {
          problems.push(`${relative(src, file)}: ${side} imports ${target} (${spec})`);
        }
      }
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const src = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  const problems = checkSides(src);
  if (problems.length) {
    console.error('\n  X side rule broken (client and server never import each other; shared imports neither):\n');
    for (const p of problems) console.error(`    ${p}`);
    console.error('');
    process.exit(1);
  }
  console.error('  - sides clean');
}
