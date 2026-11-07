// The Rapier package's `rapier_wasm3d.js` without its `import * as wasm from "./rapier_wasm3d_bg.wasm"` (vite/rapier.ts
// aliases it here): the wasm-bindgen class wrappers only. src/shared/engine/physics/rapier.ts instantiates the binary and hands its
// exports to them (`__wbg_set_wasm`) before anything constructs a Rapier object.
export * from '@dimforge/rapier3d-simd/rapier_wasm3d_bg.js';
