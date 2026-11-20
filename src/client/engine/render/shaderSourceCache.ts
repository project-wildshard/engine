type Kind = 'lower' | 'wrap' | 'finish';
export type SourceBook = Record<Kind, Record<string, unknown>>;
const empty = (): SourceBook => ({ lower: {}, wrap: {}, finish: {} });
const count = () => ({ lower: 0, wrap: 0, finish: 0 });

export interface SourceSession {
  readonly book: SourceBook;
  readonly hits: ReturnType<typeof count>;
  readonly emitted: ReturnType<typeof count>;
}
let active: SourceSession | undefined;

export const shaderSourceCacheActive = (): boolean => active !== undefined;
/** A 64-bit content key over the text's UTF-16 units (two seeded 32-bit multiply-xor lanes, cross-mixed) plus its length.
 *  Meta IPHONE13-DRIFTWOOD DW7 (mini-dw-boot, 2026-11-20): it was a JS SHA-256 of the UTF-8 bytes, 183 of 2050 profiler
 *  samples in Driftwood's home step on the iPhone 13. The book is per build and zone (shaderSourceStore), so a key never
 *  crosses builds, and a few hundred keys in 64 bits do not collide. */
export function sourceKey(text: string): string {
  let a = 0xdeadbeef ^ text.length, b = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const unit = text.codePointAt(i) ?? 0;
    a = Math.imul(a ^ unit, 0x9e3779b1); b = Math.imul(b ^ unit, 0x5f356495);
  }
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b) ^ Math.imul(b ^ (b >>> 13), 0xc2b2ae35);
  b = Math.imul(b ^ (b >>> 16), 0x85ebca6b) ^ Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}.${text.length.toString(36)}`;
}

/** One boot owns its table. The renderers never hold its persistence port. */
export function beginShaderSourceSession(book: SourceBook = empty()): SourceSession {
  const session = { book, hits: count(), emitted: count() };
  active = session;
  return session;
}

export function endShaderSourceSession(session: SourceSession): void {
  if (session === active) active = undefined;
}

export function replaySource(kind: Kind, key: string): unknown {
  if (active === undefined) return undefined;
  const saved = active.book[kind][key];
  if (saved !== undefined) active.hits[kind]++;
  return saved;
}

export function recordSource(kind: Kind, key: string, value: unknown): void {
  if (active === undefined) return;
  active.emitted[kind]++;
  active.book[kind][key] = value;
}
