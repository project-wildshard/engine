/** @typedef {import('../client/engine/debug/probe.ts').GameplayState} GameplayState */
/** @typedef {{instance: string, slug: string}} ProofCell */
/** @typedef {{
 * __wildshard?: {world?: object, state: () => GameplayState, area?: () => {flags: readonly string[]} | null,
 *   shard?: {grid?: {state: () => {cells: readonly ProofCell[], inside: string | null}}}},
 * __workerClient?: () => {cell: number, flags: readonly string[], quests: Readonly<Record<string, string | null>>},
 * __workerClientNet?: () => {client: Pick<import('../client/engine/net/client.ts').NetClient, 'flags' | 'phased' | 'quests'>},
 * __workerClientRows?: (kind: string) => readonly {x: number, y: number, z: number}[]
 * }} ProofWindow */

/** Read one gameplay snapshot in the browser: authoritative worker quests and requested live creature kinds, plus
 * the seat's named grid cell. Closure-free: pass directly to page.evaluate(readProofState, {creatureKinds: ['boar']}).
 * The local probe is retained on a page without a worker; null means the gameplay probe is unavailable (the title).
 * @param {{creatureKinds?: readonly string[]}} [options]
 */
export function readProofState({creatureKinds = []} = {}) {
  const W = /** @type {ProofWindow} */ (/** @type {unknown} */ (window));
  const probe = W.__wildshard;
  if (typeof probe?.state !== 'function' || probe.world === undefined) return null;
  const state = probe.state(), worker = W.__workerClient?.(), client = W.__workerClientNet?.().client;
  const grid = probe.shard?.grid?.state();
  // Wire seats are 1-based; zero is the road. Never infer the server seat from the page's visual inside cell.
  const cell = worker?.cell, placed = cell !== undefined && cell > 0 ? grid?.cells[cell - 1] : undefined;
  const seat = cell === undefined ? null : {cell, instance: placed?.instance ?? null, slug: placed?.slug ?? null,
    inside: grid?.inside ?? null, status: placed !== undefined ? 'cell' : cell === 0 ? (grid === undefined ? 'local' : 'road') : 'unknown'};
  const quest = typeof state.quest === 'object' && state.quest !== null ? state.quest : {};
  const flags = [...new Set(client === undefined ? worker?.flags ?? probe.area?.()?.flags ?? [] : [...client.flags(), ...client.phased])].sort();
  const quests = client === undefined ? Object.entries(worker?.quests ?? {}).map(([id, step]) => ({quest: id, started: step !== 'unstarted', step: step === 'unstarted' ? null : step})) : [...client.quests.values()].map(row => ({quest: row.quest, started: row.started, step: row.step, n: row.n}));
  quests.sort((a, b) => a.quest.localeCompare(b.quest));
  const creatures = worker === undefined ? state.creatures : [...new Set(creatureKinds)].flatMap(kind =>
    (W.__workerClientRows?.(kind) ?? []).map(pos => ({kind, pos: {...pos}})));
  return {...state, quest: {...quest, flags, phased: client === undefined ? null : [...client.phased].sort(), quests}, creatures, seat};
}
