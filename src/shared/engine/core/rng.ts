/** Mulberry32 continuation, including fork seed and the legacy scrambled-fork mode. */
export interface RngState { version: number; state: number; initial: number; scrambledFork: boolean }
/** Public seeded draws and continuation; independent of a generator's private storage. */
export interface RngPort {
  readonly next: () => number;
  readonly range: (a: number, b: number) => number;
  readonly int: (a: number, b: number) => number;
  readonly pick: <T>(arr: readonly T[]) => T;
  readonly chance: (p: number) => boolean;
  readonly weighted: <T>(pairs: readonly (readonly [T, number])[]) => T;
  readonly fork: (salt: number | string) => RngPort;
  readonly snapshot: () => RngState;
  readonly restore: (state: RngState) => void;
}
const uint32 = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
function validateRngState(state: RngState): void {
  if (state.version !== 1 || !uint32(state.state) || !uint32(state.initial) || typeof state.scrambledFork !== 'boolean') throw new RangeError('Invalid RNG snapshot');
}
// Deterministic PRNG (mulberry32) so every playtest sees the same chunk.
export class Rng implements RngPort {
  private s: number;
  private initial: number;
  private scrambledFork = false;
  constructor(seed: number) { this.s = seed >>> 0; this.initial = this.s; }
  snapshot(): RngState { return { version: 1, state: this.s, initial: this.initial, scrambledFork: this.scrambledFork }; }
  restore(state: RngState): void {
    validateRngState(state);
    this.s = state.state; this.initial = state.initial; this.scrambledFork = state.scrambledFork;
  }
  /** Preserve the facade grammar's multiplicative constructor and numeric forks. */
  static scrambled(seed: number): Rng {
    const rng = new Rng((seed * 2654435761) >>> 0);
    rng.scrambledFork = true;
    return rng;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)] as T; } // an empty list yields undefined, as it always did
  chance(p: number): boolean { return this.next() < p; }
  weighted<T>(pairs: readonly (readonly [T, number])[]): T {
    let sum = 0;
    for (const [, weight] of pairs) sum += weight;
    let r = this.next() * sum;
    for (const [item, weight] of pairs) { r -= weight; if (r <= 0) return item; }
    const last = pairs[pairs.length - 1];
    if (last === undefined) throw new Error('Rng.weighted on an empty list');
    return last[0];
  }
  fork(salt: number | string): Rng {
    if (typeof salt === 'string') return new Rng(fnv1a32(`${String(this.initial)}:${salt}`));
    const seed = (this.s ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    return this.scrambledFork ? Rng.scrambled(seed) : new Rng(seed);
  }
}

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ (text.codePointAt(i) ?? 0), 0x01000193);
  return hash >>> 0;
}
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
