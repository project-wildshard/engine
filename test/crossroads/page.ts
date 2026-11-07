import type { NetClient } from '../../src/client/engine/net/client';
import { NET_BUTTONS } from '../../src/shared/engine/input/netButtons';
import type { SaveStorage } from '../../src/shared/engine/saves/store';
import { GridAssembly } from '../../src/shared/game/grid/assembly';
import { connectStandalone, type StandaloneShell } from '../../src/client/host/standalone/shell';
import type { ProofAsk, ProofStart, WorkerReading } from './worker';

// E5.2b: what the server worker costs at a crossroads, on the real phone. The worker is the real server half: it boots on the road at
// the corner of four cells and a real client walks it into each, so the worker holds what a player's walk makes it hold. The four
// cells at this corner are the heaviest block on the grid: Driftwood, Nalati, Pine Hollow and the template.
// Safari reports no heap, so step 2 finds it the only way a page can: fill memory until the tab is killed, with the worker and without.
// scripts/crossroads-smoke.mjs drives the same page on this Mac.

const SLUG = 'driftwood-isle', PREFIX = 'wildshard.', BLOCK = 8 * 1024 * 1024, BALLOON = 'crossroads.balloon', RESULTS = 'crossroads.results';
const assembly = new GridAssembly({ developer: false, devserver: false }), corner = { x: assembly.pitch / 2, z: assembly.pitch / 2 };
const atCorner = [[1, 0], [0, 1], [0, 0], [1, 1]].map(([x, z]) => {
  const cell = assembly.cells.find(row => row.cell[0] === x && row.cell[1] === z);
  if (cell === undefined) throw new Error('Missing crossroads cell');
  return cell;
});
const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
const element = (id: string): HTMLElement => { const found = document.getElementById(id); if (found === null) throw new Error(`Missing ${id}`); return found; };
const say = (text: string): void => { element('status').textContent = text; };
const failed = (error: unknown): void => { say(`Failed: ${String(error)}`); };
const MB = (bytes: number): string => (bytes / 1048576).toFixed(1);

class MemoryStorage implements SaveStorage {
  private readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
/** One server worker and the client that drives it. */
interface Session { readonly shell: StandaloneShell; readonly client: NetClient; ask: (message: ProofAsk) => Promise<Record<string, unknown>>; stop: () => void }

async function open(start: ProofStart, storage: SaveStorage = new MemoryStorage()): Promise<Session> {
  const worker = new Worker(new URL('worker.ts', import.meta.url), { type: 'module' }), control = new MessageChannel(), game = new MessageChannel(), proof = new MessageChannel();
  worker.postMessage(start, [control.port2, game.port2, proof.port2]);
  const shell = connectStandalone({ slug: SLUG, base: `/shards/${SLUG}/`, build: '', savePrefix: PREFIX, storage, identity: { player: 'crossroads', name: 'Crossroads' } }, control.port1, game.port1, () => { worker.terminate(); });
  await shell.booted; shell.ready();
  while (shell.client.latest === null) await wait(5);
  return { shell, client: shell.client, stop: () => { shell.dispose(); }, ask: message => new Promise(resolve => { proof.port1.onmessage = event => { resolve(event.data as Record<string, unknown>); }; proof.port1.postMessage(message); }) };
}
/** The player's world point, from the owner block of the latest frame. */
function worldAt(session: Session): { x: number; z: number; cell: number } {
  const { client } = session, frame = client.latest;
  if (frame === null) throw new Error('No frame');
  const owner = client.owner(frame), local = { x: Number(owner['px']), z: Number(owner['pz']) }, cell = frame.cell === 0 ? undefined : assembly.cells[frame.cell - 1];
  return { x: local.x + (cell?.origin.x ?? 0), z: local.z + (cell?.origin.z ?? 0), cell: frame.cell };
}
/** Sprint towards a world point until `done`. */
async function walkTo(session: Session, target: { x: number; z: number }, done: (at: ReturnType<typeof worldAt>) => boolean, seconds = 30): Promise<void> {
  const until = performance.now() + seconds * 1000;
  for (;;) {
    await new Promise(resolve => { requestAnimationFrame(resolve); });
    if (session.client.latest === null) continue; // a crossing's welcome: its first frame is on the way
    const at = worldAt(session);
    if (done(at)) return;
    if (performance.now() > until) throw new Error(`Stuck at ${at.x.toFixed(1)},${at.z.toFixed(1)} in cell ${String(at.cell)}`);
    const yaw = Math.atan2(at.x - target.x, at.z - target.z);
    for (let step = 0; step < 2; step++) session.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: NET_BUTTONS.sprint });
    session.client.flush();
  }
}
/** Across the road into a cell at its near corner, and back to the crossroads. */
async function visit(session: Session, cell: (typeof atCorner)[number]): Promise<void> {
  const index = assembly.cells.indexOf(cell) + 1, inside = { x: cell.origin.x + Math.sign(corner.x - cell.origin.x) * 240, z: cell.origin.z + Math.sign(corner.z - cell.origin.z) * 240 };
  await walkTo(session, inside, at => at.cell === index, 120);
}
const home = async (session: Session): Promise<void> => { await walkTo(session, corner, at => at.cell === 0 && Math.hypot(at.x - corner.x, at.z - corner.z) < 4); };
async function reading(session: Session): Promise<WorkerReading & { page: string }> {
  const worker = await session.ask({ kind: 'reading' }) as unknown as WorkerReading;
  const measure = (performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number; breakdown: { bytes: number; attribution: { scope?: string }[]; types: string[] }[] }> }).measureUserAgentSpecificMemory;
  if (measure === undefined || !globalThis.crossOriginIsolated) return { ...worker, page: 'no heap api' };
  const heap = await measure.call(performance).catch(() => null);
  if (heap === null) return { ...worker, page: 'no heap api' };
  const inWorker = heap.breakdown.filter(row => row.attribution.some(entry => entry.scope === 'DedicatedWorkerGlobalScope')).reduce((sum, row) => sum + row.bytes, 0);
  return { ...worker, bytes: inWorker, page: `total ${MB(heap.bytes)} MB` };
}
function percentile(values: readonly number[], at: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))] ?? 0; }
const line = (name: string, row: Awaited<ReturnType<typeof reading>>): string => `${name}: wasm ${MB(row.wasmBytes)} MB, worlds ${String(row.residents)}, near solids ${row.solids}, save copies ${MB(row.docsChars * 2)} MB${row.bytes === null ? '' : `, worker ${MB(row.bytes)} MB`}, ${row.page}`;

/** The shipped server on a walk through all four cells, then the design's four worlds at once. */
async function run(label: string, pause: (name: string) => Promise<void> = () => Promise.resolve()): Promise<string[]> {
  const lines = [label, navigator.userAgent, `isolated=${String(globalThis.crossOriginIsolated)}`];
  const put = (text: string): void => { lines.push(text); element('out').textContent = lines.join('\n'); };
  let frames = 0, counting = true;
  const frame = (): void => { frames++; if (counting) requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  say('Walking the crossroads…');
  const started = performance.now(), session = await open({ arrival: { x: corner.x, y: 0, z: corner.z } });
  put(`Boot ${(performance.now() - started).toFixed(0)} ms`);
  put(line('Road', await reading(session)));
  await pause('road');
  for (const cell of atCorner) {
    const entered = performance.now();
    await visit(session, cell);
    put(line(`${cell.slug} in ${((performance.now() - entered) / 1000).toFixed(1)} s`, await reading(session)));
    await pause(cell.slug);
    await home(session);
  }
  const { ms } = await session.ask({ kind: 'ticks' }) as { ms: number[] };
  put(`Tick ms: p50 ${percentile(ms, 0.5).toFixed(2)}, p95 ${percentile(ms, 0.95).toFixed(2)}, max ${percentile(ms, 1).toFixed(1)}, ${String(ms.length)} ticks in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  put(line('Back on the road', await reading(session)));
  session.stop();
  say('Holding four worlds…');
  await wait(1000);
  const four = await open({ arrival: { x: corner.x, y: 0, z: corner.z }, residents: 4 }), admitted = await four.ask({ kind: 'admit', instances: atCorner.map(cell => cell.instance) });
  if (typeof admitted['error'] === 'string') put(`Four worlds refused: ${admitted['error']}`);
  put(line('Four worlds, as designed', await reading(four)));
  await pause('four');
  four.stop();
  counting = false;
  put(`Page frames/s ${(frames / ((performance.now() - started) / 1000)).toFixed(1)}`);
  say('Done. Copy the results and paste them to Claude.');
  localStorage.setItem(RESULTS, `${localStorage.getItem(RESULTS) ?? ''}${lines.join('\n')}\n\n`);
  return lines;
}

/** Fill memory until the tab dies. Progress is written first, so the page that comes back knows how far it got. */
async function fill(phase: string, worker: number): Promise<void> {
  const held: Uint8Array[] = [];
  let seed = 0x9e3779b9;
  try {
    for (;;) {
      localStorage.setItem(BALLOON, JSON.stringify({ phase, blocks: held.length, worker }));
      const block = new Uint32Array(BLOCK / 4); // random, because iOS compresses anything simpler
      for (let index = 0; index < block.length; index++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; block[index] = seed; }
      held.push(new Uint8Array(block.buffer));
      say(`Filling: ${String(held.length * 8)} MB`);
      await wait(0);
    }
  } catch { // refused rather than killed: the same limit, reached politely
    held.length = 0;
    await resume();
  }
}
async function withWorker(): Promise<void> {
  say('Walking into the heaviest cell…');
  const session = await open({ arrival: { x: corner.x, y: 0, z: corner.z } }), [heaviest] = atCorner;
  if (heaviest === undefined) throw new Error('Missing cell');
  await visit(session, heaviest);
  await fill('worker', 0);
}
/** Pick up after a kill: `worker` comes first, so a kill there starts `alone`; a kill there ends it. */
async function resume(): Promise<void> {
  const raw = localStorage.getItem(BALLOON), saved = raw === null ? null : JSON.parse(raw) as { phase: string; blocks: number; worker: number };
  if (saved === null) return;
  if (saved.phase === 'alone') { report(saved.worker, saved.blocks); return; }
  const worker = saved.phase === 'worker' ? saved.blocks : saved.worker;
  localStorage.setItem(BALLOON, JSON.stringify({ phase: 'waiting', blocks: 0, worker }));
  say('First fill done. Filling again with no worker…');
  await wait(1500);
  await fill('alone', worker);
}
function report(worker: number, alone: number): void {
  localStorage.removeItem(BALLOON);
  const text = `Balloon: ${String(alone * 8)} MB alone, ${String(worker * 8)} MB with the worker holding the heaviest cell, so the worker costs ${String((alone - worker) * 8)} MB (±8)`;
  localStorage.setItem(RESULTS, `${localStorage.getItem(RESULTS) ?? ''}${text}\n`);
  say('Done. Copy the results and paste them to Claude.');
  element('out').textContent = localStorage.getItem(RESULTS);
}

/** What the smoke drives. */
export interface CrossroadsProof { open: typeof open; run: typeof run; wait: typeof wait; visit: (session: Session, index: number) => Promise<void>; home: typeof home; reading: typeof reading; atCorner: typeof atCorner; corner: typeof corner; worldAt: typeof worldAt }
declare global { interface Window { crossroads: CrossroadsProof } }
window.crossroads = { open, run, wait, home, reading, atCorner, corner, worldAt, visit: async (session, index) => { const cell = atCorner[index]; if (cell !== undefined) await visit(session, cell); } };
const buttons = [element('low'), element('full'), element('balloon')] as HTMLButtonElement[];
const busy = (): void => { for (const button of buttons) button.disabled = true; };
const start = (label: string) => (): void => { busy(); void run(label).catch(failed).finally(() => { for (const button of buttons) button.disabled = false; }); };
element('low').onclick = start('Low Power Mode on');
element('full').onclick = start('Low Power Mode off');
element('balloon').onclick = () => { busy(); void withWorker().catch(failed); };
element('copy').onclick = () => { void (async () => { await navigator.clipboard.writeText(element('out').textContent); say('Copied'); })().catch(failed); };
element('out').textContent = localStorage.getItem(RESULTS);
void resume().catch(failed);
