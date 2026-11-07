// Plain Node type stripping plus the same Rapier binding selection as the client/tests; no app identity or shard list.
import './format-hook.mjs';
import { registerHooks } from 'node:module';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Exact reviewed schema leaves stay dependency-guarded by lint/sim-closure.mjs; SF16 owns removal.
const schemaLeaves = new Set(Object.keys(JSON.parse(readFileSync(new URL('../lint/sim-schema-leaves.json', import.meta.url), 'utf8'))).map((path) => new URL(`../${path}`, import.meta.url).href));
/** @param {string} url */
const rendererDependency = (url) => !schemaLeaves.has(url) && /\/src\/(?:client|cook|server|shared)\/engine\/(?:app\/runtime\.ts|render\/|ui\/|fx\/|anim\/|.*\/view\/)/u.test(url);

const workspace = new Map();

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@dimforge/rapier3d-simd') return next('@dimforge/rapier3d-simd/rapier.js', context);
    if (/^\.\/rapier_wasm3d(?:\.js)?$/u.test(specifier)) return { url: new URL('../src/server/engine/physics/rapierBindings.ts', import.meta.url).href, shortCircuit: true };
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
    const result = next(specifier, context);
    if (rendererDependency(result.url)) throw new Error(`Renderer dependency in Node simulation: ${result.url}`);
    if (specifier.startsWith('@wildshard/')) workspace.set(specifier, result.url);
    return result;
  },
});
