// Plain Node type stripping plus the same Rapier binding selection as the client/tests; no app identity or shard list.
import './format-hook.mjs';
import { registerHooks } from 'node:module';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Exact reviewed schema leaves stay dependency-guarded by lint/sim-closure.mjs; SF16 owns removal.
const schemaLeaves = new Set(Object.keys(JSON.parse(readFileSync(new URL('../../lint/sim-schema-leaves.json', import.meta.url), 'utf8'))).map((path) => new URL(`../${path}`, import.meta.url).href));
/** @param {string} url */
const rendererDependency = (url) => !schemaLeaves.has(url) && /\/src\/(?:client|cook|server|shared)\/engine\/(?:app\/runtime\.ts|render\/|ui\/|fx\/|anim\/|.*\/view\/)/u.test(url);

const workspace = new Map();

// QA 2026-11-23 row 2b (opus-perf1): an engine module asking for `@wildshard/engine/<path>` is a self-reference, which Node
// resolves through this package's own exports map, and Node re-reads that 100 KB package.json for every one (~250 ms of each
// sim thread's import). Read the map once and answer the same way: only from a module under src/ (no package.json sits
// between it and this one), only for an exact string target to a file that exists; anything else goes to Node as before.
const ENGINE = '@wildshard/engine/';
const engineRoot = new URL('../../', import.meta.url).href, engineSource = new URL('../', import.meta.url).href;
const enginePackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
/** @type {Record<string, unknown>} */
const engineExports = enginePackage.name === '@wildshard/engine' && typeof enginePackage.exports === 'object' && enginePackage.exports !== null ? enginePackage.exports : {};
/** @param {string} specifier @param {string | undefined} parent @returns {string | undefined} */
function selfReference(specifier, parent) {
  if (!specifier.startsWith(ENGINE) || parent === undefined || !parent.startsWith(engineSource)) return undefined;
  const target = engineExports[`./${specifier.slice(ENGINE.length)}`];
  if (typeof target !== 'string' || !target.startsWith('./') || target.split('/').some((part) => part === '..' || part === 'node_modules')) return undefined;
  const url = new URL(target, engineRoot);
  return existsSync(fileURLToPath(url)) && statSync(fileURLToPath(url)).isFile() ? url.href : undefined;
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@dimforge/rapier3d-simd') return next('@dimforge/rapier3d-simd/rapier.js', context);
    if (/^\.\/rapier_wasm3d(?:\.js)?$/u.test(specifier)) return { url: new URL('../server/engine/physics/rapierBindings.ts', import.meta.url).href, shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const at = new URL(specifier, context.parentURL);
      for (const suffix of ['', '.ts', '.js', '/index.ts', '/index.js']) {
        const url = new URL(at.href + suffix);
        if (existsSync(fileURLToPath(url)) && statSync(fileURLToPath(url)).isFile()) {
          if (rendererDependency(url.href)) throw new Error(`Renderer dependency in Node simulation: ${url.href}`);
          return { url: url.href, shortCircuit: true };
        }
      }
    }
    // A workspace specifier means one file from any parent. Node re-parses a layer's whole exports map per
    // resolve, the top cost of a sim worker's import, and each worker pays it again for its 700 modules.
    const known = workspace.get(specifier);
    if (known !== undefined) return { url: known, shortCircuit: true };
    const own = selfReference(specifier, context.parentURL);
    if (own !== undefined) {
      if (rendererDependency(own)) throw new Error(`Renderer dependency in Node simulation: ${own}`);
      workspace.set(specifier, own);
      return { url: own, shortCircuit: true };
    }
    const result = next(specifier, context);
    if (rendererDependency(result.url)) throw new Error(`Renderer dependency in Node simulation: ${result.url}`);
    if (specifier.startsWith('@wildshard/')) workspace.set(specifier, result.url);
    return result;
  },
});
