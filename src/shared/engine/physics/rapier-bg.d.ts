// The one symbol of Rapier's wasm-bindgen glue the loader needs (the package types its public API, not this module).
declare module '@dimforge/rapier3d-simd/rapier_wasm3d_bg.js' {
  /** Hand the instantiated module's exports to the class wrappers; every Rapier call goes through them. */
  export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
}
