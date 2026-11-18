/**
 * ENGINE-MEMORY EM21: Rapier's compiled `WebAssembly.Module`, compiled once per page. The page's own physics instantiates
 * from it, and the page posts the same module to the standalone server's worker (shell.ts), so no second isolate compiles
 * Rapier's code or tiers it up again: on iOS both isolates are threads of one WebContent process. Its own module so the
 * page shell can hand it on without importing Rapier's bindings.
 */
import { RAPIER_WASM_URL } from './wasmUrl';

let compiling: Promise<WebAssembly.Module> | null = null;
let compiled: WebAssembly.Module | null = null;

/** Compile Rapier from its URL once, streamed (compilation overlaps the download, off the main thread). */
export function compileRapier(): Promise<WebAssembly.Module> {
  compiling ??= WebAssembly.compileStreaming(fetch(RAPIER_WASM_URL)).then(module => { compiled = module; return module; });
  return compiling;
}

/** A compiled module from any realm (a test runner's or a posted one's `instanceof` can name another realm's class). */
export const isWasmModule = (value: unknown): value is WebAssembly.Module => Object.prototype.toString.call(value) === '[object WebAssembly.Module]';

/** The compiled module if this realm has finished compiling it, else null (a worker then compiles its own, as before). */
export function compiledRapier(): WebAssembly.Module | null { return compiled; }
