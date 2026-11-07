/**
 * Loads Rapier (project/archive/2026-09-23-physics.md §Architecture, Loading). The only module that instantiates the WASM; every
 * other physics module imports Rapier's API from here, after `loadRapier()` resolved.
 *
 * The binary is fetched from /assets/physics/rapier.wasm (vite/rapier.ts copies it there from the package) and
 * compiled with `instantiateStreaming`, so compilation overlaps the download and runs off the main thread. `loadRapier()`
 * is called at the very start of boot and awaited by the `physics` step, by which time it has usually finished.
 * Rapier 0.21 keeps the root-level bindings/binary and the same wasm-bindgen import namespace.
 * SIMD build only: the iOS app targets 17 and the web build needs Safari ≥ 16.4.
 */
import RAPIER from '@dimforge/rapier3d-simd';
import * as bindings from '@dimforge/rapier3d-simd/rapier_wasm3d_bg.js';
import { RAPIER_WASM_URL } from './wasmUrl';
import { observeWasmMemory } from '../core/memoryResources';

/** Initialized Rapier bindings supplied to a physics world or renderer-free simulation host. */
export type Rapier = typeof RAPIER;

let loading: Promise<Rapier> | null = null;

/** Instantiate the WASM once (idempotent). `bytes`: the binary itself, for node (tests, bake scripts) where there is no fetch of /assets. */
export function loadRapier(bytes?: BufferSource): Promise<Rapier> {
  loading ??= (async () => {
    const imports = { './rapier_wasm3d_bg.js': bindings };
    const { instance } = bytes === undefined
      ? await WebAssembly.instantiateStreaming(fetch(RAPIER_WASM_URL), imports)
      : await WebAssembly.instantiate(bytes, imports);
    bindings.__wbg_set_wasm(instance.exports);
    const memory = instance.exports['memory'];
    if (memory instanceof WebAssembly.Memory) observeWasmMemory(memory, { owner: 'engine/physics', asset: RAPIER_WASM_URL });
    return RAPIER;
  })();
  return loading;
}
