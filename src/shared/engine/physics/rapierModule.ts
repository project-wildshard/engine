/**
 * ENGINE-MEMORY EM21: Rapier's compiled `WebAssembly.Module`, compiled once per page. The page's own physics instantiates
 * from it, and the page posts the same module to the standalone server's worker (shell.ts), so no second isolate compiles
 * Rapier's code or tiers it up again: on iOS both isolates are threads of one WebContent process. Its own module so the
 * page shell can hand it on without importing Rapier's bindings.
 */
import { RAPIER_WASM_URL } from './wasmUrl';

/** The realm's one compile, on the global object: the page's session code and the standalone shell are separate builds,
 *  each with its own copy of this module, and must still see one module. */
interface Slot { compiling: Promise<WebAssembly.Module> | null; compiled: WebAssembly.Module | null }
const SLOT = Symbol.for('wildshard.rapierModule');
function slot(): Slot {
  const held: unknown = Reflect.get(globalThis, SLOT);
  if (typeof held === 'object' && held !== null && 'compiling' in held && 'compiled' in held) return held as Slot;
  const made: Slot = { compiling: null, compiled: null };
  Reflect.set(globalThis, SLOT, made);
  return made;
}

/** Compile Rapier from its URL once, streamed (compilation overlaps the download, off the main thread). */
export function compileRapier(): Promise<WebAssembly.Module> {
  const at = slot();
  at.compiling ??= WebAssembly.compileStreaming(fetch(RAPIER_WASM_URL)).then(module => { at.compiled = module; return module; });
  return at.compiling;
}

/** A compiled module from any realm (a test runner's or a posted one's `instanceof` can name another realm's class). */
export const isWasmModule = (value: unknown): value is WebAssembly.Module => Object.prototype.toString.call(value) === '[object WebAssembly.Module]';

/** The compiled module if this realm has finished compiling it, else null (a worker then compiles its own, as before). */
export function compiledRapier(): WebAssembly.Module | null { return slot().compiled; }
