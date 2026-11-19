import { sha256 } from '../../../shared/engine/core/sha256';

type Kind = 'lower' | 'wrap' | 'finish';
export type SourceBook = Record<Kind, Record<string, unknown>>;
const empty = (): SourceBook => ({ lower: {}, wrap: {}, finish: {} });
const count = () => ({ lower: 0, wrap: 0, finish: 0 });
const encoder = new TextEncoder();

export interface SourceSession {
  readonly book: SourceBook;
  readonly hits: ReturnType<typeof count>;
  readonly emitted: ReturnType<typeof count>;
}
let active: SourceSession | undefined;

export const shaderSourceCacheActive = (): boolean => active !== undefined;
export const sourceKey = (text: string): string => sha256(encoder.encode(text));

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
