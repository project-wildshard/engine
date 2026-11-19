import { Rng, fnv1a32, validateRngState, type RngState } from '@wildshard/format/seededRng';

const uint32 = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
export interface RngStreams { gameplay: true; ai: true; spawn: true; cosmetic: true }
export type RngStream = keyof RngStreams;
/** Seed and complete continuation state for every instantiated named random stream. */
export interface RngStreamsState { version: number; seed: number; streams: readonly { name: RngStream; state: RngState }[] }
class RandomStreams {
  private streams = new Map<RngStream, Rng>();
  private value: number;
  constructor(seed = 0) { this.value = seed >>> 0; }
  snapshot(): RngStreamsState {
    return { version: 1, seed: this.value, streams: [...this.streams].sort(([a], [b]) => a.localeCompare(b)).map(([name, rng]) => ({ name, state: rng.snapshot() })) };
  }
  restore(state: RngStreamsState): void {
    if (state.version !== 1 || !uint32(state.seed) || new Set(state.streams.map((entry) => entry.name)).size !== state.streams.length) throw new RangeError('Invalid RNG streams snapshot');
    for (const entry of state.streams) validateRngState(entry.state);
    this.value = state.seed;
    const keep = new Set(state.streams.map((entry) => entry.name));
    for (const name of this.streams.keys()) if (!keep.has(name)) this.streams.delete(name);
    for (const entry of state.streams) this.stream(entry.name).restore(entry.state);
  }
  get seedValue(): number { return this.value; }
  seed(value: number): void { this.value = value >>> 0; this.streams.clear(); }
  stream(name: RngStream): Rng {
    let rng = this.streams.get(name);
    if (!rng) { rng = new Rng(fnv1a32(`${String(this.value)}:${name}`)); this.streams.set(name, rng); }
    return rng;
  }
}
export { RandomStreams as RngService };

/** Harness pins every stream; a live page gets one crypto salt without consuming gameplay draws. */
export function pageSeed(seed: number, harnessSeed?: number): number {
  if (harnessSeed !== undefined) return harnessSeed >>> 0;
  return (seed ^ (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0)) >>> 0;
}
