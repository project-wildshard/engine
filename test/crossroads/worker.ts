import { loadRapier } from '../../src/shared/engine/physics/rapier';
import type { GridPoint } from '../../src/shared/game/grid/assembly';
import type { StandaloneGrid } from '../../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../../src/server/host/standalone/serverHost';
import { fetchServerFolder } from '../../src/server/host/standalone/serverFolder';

// E5.2b: the real server half in a real module worker, as `serverWorker.ts` runs it, with the proof's ways in: boot at a point on
// the road, hold a chosen number of worlds, and report what the worker holds. It never ships.

/** What a reading asks, on the proof port. */
export type ProofAsk = { readonly kind: 'admit'; readonly instances: readonly string[] } | { readonly kind: 'reading' } | { readonly kind: 'ticks' };
/** What the worker can say about its own memory. WebKit has no heap number: the page's balloon gives that one. */
export interface WorkerReading { readonly wasmBytes: number; readonly residents: number; readonly docsChars: number; readonly solids: string; readonly bytes: number | null }
/** The boot message's data. */
export interface ProofStart { readonly arrival?: GridPoint; readonly residents?: number }

// A reading of the worker's Rapier heap needs the instance: record it as it is made, as `observeWasmMemory` does.
let wasm: WebAssembly.Memory | null = null;
const instantiate = WebAssembly.instantiateStreaming.bind(WebAssembly);
WebAssembly.instantiateStreaming = async (...args) => {
  const made = await instantiate(...args), { memory } = made.instance.exports;
  if (memory instanceof WebAssembly.Memory) wasm = memory;
  return made;
};

self.onmessage = (event: MessageEvent<ProofStart>): void => {
  self.onmessage = null;
  const [control, game, proof] = event.ports;
  if (control === undefined || game === undefined || proof === undefined) return;
  let server: StandaloneGrid | undefined;
  const ticks: number[] = [];
  runStandaloneServer({ control, game, load: async (boot, slug) => fetchServerFolder(new URL(`../${slug}/`, new URL(boot.base, globalThis.location.href)).href, await loadRapier()),
    proof: { ...event.data, ticked: ms => { ticks.push(ms); }, booted: running => { server = running; } } });
  const answer = (message: Record<string, unknown>): void => { proof.postMessage(message, []); };
  const admit = async (instances: readonly string[]): Promise<Record<string, unknown>> => {
    try { await server?.grid.prefetch(instances); return { kind: 'admitted' }; } catch (error) { return { kind: 'admitted', error: String(error) }; }
  };
  proof.onmessage = (ask: MessageEvent<ProofAsk>): void => {
    const { data } = ask;
    if (data.kind === 'admit') {
      void admit(data.instances).then(answer);
    } else if (data.kind === 'ticks') answer({ kind: 'ticks', ms: ticks.splice(0) });
    else answer({ kind: 'reading', wasmBytes: wasm?.buffer.byteLength ?? 0, residents: server?.residents ?? 0, docsChars: server?.docsChars ?? 0, solids: server === undefined ? '' : `${String(server.near.live)}/${String(server.near.held)}`, bytes: null } satisfies WorkerReading & { kind: string });
  };
};
