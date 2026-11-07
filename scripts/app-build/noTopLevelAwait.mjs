import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseSync } from 'vite';

/** Await in an async function does not suspend the containing module. Computed
 * class/object keys and top-level control flow still run during evaluation. */
function suspendsModule(node) {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(suspendsModule);
  if ('type' in node) {
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return false;
    if (node.type === 'AwaitExpression' || node.type === 'ForOfStatement' && node.await === true
      || node.type === 'VariableDeclaration' && node.kind === 'await using') return true;
  }
  return Object.values(node).some(suspendsModule);
}

/** Safari before 27 can evaluate dynamic-import dependants before a suspended
 * module's body. Reject actual emitted app code, not config/build-time await. */
export function assertNoTopLevelAwait(fileName, code) {
  const parsed = parseSync(fileName, code, { lang: 'js', sourceType: 'module' });
  if (parsed.errors.length > 0) throw new Error(`Cannot check emitted app JavaScript ${fileName}: ${parsed.errors.map(error => error.message).join('; ')}`);
  if (suspendsModule(parsed.program)) throw new Error(`Top-level await in emitted app chunk ${fileName}: move readiness into an async function before importing its consumers`);
}

/** Every JavaScript file the build wrote to `outDir` (lazy chunks and worker assets too), read from disk after the
 *  build, so a late output hook's edits are checked as well. A copy of a `publicDir` file is not the bundle's (the
 *  Basis transcoder is a classic script) and is skipped, as is anything behind a symlink. */
export function checkNoTopLevelAwait(outDir, publicDir) {
  for (const entry of readdirSync(outDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.[cm]?js$/u.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name), fileName = relative(outDir, path);
    if (existsSync(resolve(publicDir, fileName))) continue;
    assertNoTopLevelAwait(fileName, readFileSync(path, 'utf8'));
  }
}
