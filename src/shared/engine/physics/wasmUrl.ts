/** Where the boot fetches Rapier's WASM (vite/rapier.ts copies it there). Its own module so the boot manifest — which
   node-side bake scripts import — names the file without importing Rapier. */
export const RAPIER_WASM_URL = '/assets/physics/rapier.wasm';
