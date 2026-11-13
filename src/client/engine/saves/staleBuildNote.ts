/**
 * STALE-BUILD SB6: index.html's `data-stale-build` script runs before any module, so it has no save service; when it stops a
 * stale build and sends the player to update, it leaves its note in localStorage `ws-stale-build` (build, built-at, the server's
 * build, tries, when). The next build that boots takes the note here, once: read, then removed. Its report then waits in the
 * device's screen outbox (`screen.reports`, telemetry/browserErrors.ts) until Sentry acknowledges it.
 */
export interface StaleBuildNote {
  readonly build: string;
  /** the stale build's own stamp (ms) */
  readonly at: number;
  /** the build the server named, '' when it named none */
  readonly server: string;
  readonly tries: number;
  /** when the stale screen last wrote the note (ms) */
  readonly seen: number;
}
export const STALE_BUILD_NOTE_KEY = 'ws-stale-build';

/** a time a Date can hold (ms); anything else is not the inline script's */
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;

/** The note as the inline script wrote it, or null for anything else. */
export function parseStaleBuildNote(raw: string | null): StaleBuildNote | null {
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { build, at, server, tries, seen } = value as Record<string, unknown>;
  if (typeof build !== 'string' || typeof server !== 'string' || typeof tries !== 'number' || !time(at) || !time(seen)) return null;
  return { build: build.slice(0, 200), at, server: server.slice(0, 200), tries, seen };
}

type NoteStore = Pick<Storage, 'getItem' | 'removeItem'>;
function pageStore(): NoteStore | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Take the note once: it is removed as it is read, and a malformed one is dropped too. Null when there is none. */
export function takeStaleBuildNote(store: NoteStore | null = pageStore()): StaleBuildNote | null {
  if (store === null) return null;
  let raw: string | null = null;
  try { raw = store.getItem(STALE_BUILD_NOTE_KEY); } catch { return null; }
  if (raw === null) return null;
  try { store.removeItem(STALE_BUILD_NOTE_KEY); } catch { return null; } // a note that can't be removed would report on every boot
  return parseStaleBuildNote(raw);
}
