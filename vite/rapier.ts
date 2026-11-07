/**
 * Rapier's WASM, loaded by the game rather than by the bundler (project/archive/2026-09-23-physics.md §Architecture, Loading).
 *
 * `@dimforge/rapier3d-simd` 0.21 is still a wasm-bindgen `bundler` build: its `rapier_wasm3d.js` does
 * `import * as wasm from "./rapier_wasm3d_bg.wasm"` (the Wasm ESM-integration proposal), which Vite does not support.
 * So that one module is aliased to src/server/engine/physics/rapierBindings.ts — the same class wrappers without the wasm import —
 * and src/shared/engine/physics/rapier.ts instantiates the binary itself (streamed from /assets/physics/, where the boot plan counts
 * its bytes and the service worker caches it like every other asset) and hands it to the wrappers.
 *
 * `copyRapierWasm()` puts the package's binary at public/assets/physics/rapier.wasm before the byte table is written
 * (gitignored: it is regenerated from node_modules by every build, like the boot packs).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Aliases for vite.config.ts and vitest.config.ts: the package's wasm-importing module → the plain bindings. */
export const rapierAlias = [
  { find: /^\.\/rapier_wasm3d(\.js)?$/, replacement: `${ROOT}src/server/engine/physics/rapierBindings.ts` },
  // the package declares only `module`; node-side resolution (vitest) wants a file
  { find: /^@dimforge\/rapier3d-simd$/, replacement: createRequire(import.meta.url).resolve('@dimforge/rapier3d-simd/rapier.js') },
];

/** Publish the installed binary for this source checkout before native product validation or boot tables. */
export function copyRapierWasm(root: string = ROOT): void {
  const source = createRequire(resolvePath(root, 'package.json')).resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm');
  const directory = resolvePath(root, 'public/assets/physics'), target = resolvePath(directory, 'rapier.wasm');
  const src = readFileSync(source);
  if (existsSync(target) && readFileSync(target).equals(src)) return;
  mkdirSync(directory, { recursive: true });
  copyFileSync(source, target);
}
