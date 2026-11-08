import { saveStorage } from '../saves/slots';
import { bootMark, bootTiming } from '../../../shared/engine/boot/timing';
import { diagnosticNow } from '../../../shared/engine/core/clock';
/** One-shot intent from the renderer-free title page to the selected shard's fresh document. */
export type TitleArrivalMode = 'enter' | 'explore' | 'arena';
export interface TitleArrival { slug: string; mode: TitleArrivalMode }

/** Device classification shared by cold arrival metadata and renderer tier selection. */
export function mobileDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod|Android/i.test(userAgent) || platform === 'MacIntel' && maxTouchPoints > 1;
}

/** Display-only tier fact for a fresh document. initializeTier updates it when
 * the actual tier is selected; cold navigation never imports rendering tables. */
export const arrivalTier: { current: 'phone' | 'desktop' } = {
  current: typeof navigator !== 'undefined' && mobileDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) ? 'phone' : 'desktop',
};

const KEY = 'titleArrival';
const BACKUP_KEY = 'titleArrival.once';
const MAX_AGE_MS = 60_000;

interface StoredArrival extends TitleArrival { at: number; name?: string; tier?: string; timing?: Readonly<Record<string, unknown>> }

/** A one-shot handoff must be fresh when this document arrives, before cold
 * modules or world admission run. Later reloads still use their own start.
 * Explicit clocks keep expiry and delayed-consumption checks deterministic. */
export function freshPageArrival(at: number, now: number = Date.now(), startedAt: number = typeof window === 'undefined' ? now : performance.timeOrigin): boolean {
  if (![at, now, startedAt].every(Number.isFinite) || at > now || startedAt > now) return false;
  return now - at <= MAX_AGE_MS || (startedAt >= at && startedAt - at <= MAX_AGE_MS);
}

function valid(raw: string | null, slug: string): TitleArrival | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as Partial<StoredArrival>;
    if (![slug].includes(candidate.slug ?? '') || (candidate.mode !== 'enter' && candidate.mode !== 'explore' && candidate.mode !== 'arena')) return null;
    if (typeof candidate.at !== 'number' || !freshPageArrival(candidate.at)) return null;
    const timing = bootTiming();
    if (timing !== undefined && candidate.timing !== undefined) timing.handoff = {
      ...candidate.timing, wall: candidate.at, received: timing.handoff?.['received'] ?? diagnosticNow(), newTimeOrigin: timing.timeOrigin,
      source: 'validated-title-arrival', validated: true, validatedAt: diagnosticNow(),
    };
    return { slug, mode: candidate.mode };
  } catch { return null; }
}

/** Optional display metadata lets the first HTML paint name the destination before application modules arrive. */
export function setTitleArrival(arrival: TitleArrival & { name?: string; tier?: string }): void {
  bootMark('app:navigation-decision', {slug: arrival.slug});
  const timing = bootTiming();
  const raw = JSON.stringify({ ...arrival, at: Date.now(), ...(timing === undefined ? {} : {timing: {
    timeOrigin: timing.timeOrigin, decision: diagnosticNow(), input: Reflect.get(timing, 'lastInput'), attempt: timing.attempt,
  }}) } satisfies StoredArrival);
  try { saveStorage('session').setItem(KEY, raw); } catch { /* the local one-shot below can carry the intent */ }
  // iOS home-screen navigation can replace WebContent between the static title and the game document.
  // The backup is consumed once, and expires quickly; it never becomes a remembered last shard.
  try { saveStorage('device').setItem(BACKUP_KEY, raw); } catch { /* the session copy may still survive */ }
}

export function consumeTitleArrival(slug: string): TitleArrival | null {
  let session: string | null = null, backup: string | null = null;
  try { session = saveStorage('session').getItem(KEY); saveStorage('session').removeItem(KEY); } catch { /* use the backup */ }
  try { backup = saveStorage('device').getItem(BACKUP_KEY); saveStorage('device').removeItem(BACKUP_KEY); } catch { /* use the session copy */ }
  return valid(session, slug) ?? valid(backup, slug);
}

/** Inspect the same fresh one-shot arrival without consuming the receiving session's handoff. */
export function pendingTitleArrival(slug: string): TitleArrival | null {
  let session: string | null = null, backup: string | null = null;
  try { session = saveStorage('session').getItem(KEY); } catch { /* the backup may survive */ }
  try { backup = saveStorage('device').getItem(BACKUP_KEY); } catch { /* the session may survive */ }
  return valid(session, slug) ?? valid(backup, slug);
}

/** DL21: the fresh arrival's display facts and tap time for the receiving document's first card, without consuming it. */
export function arrivalCard(slug: string): { name: string | undefined; tier: string | undefined; at: number } | null {
  for (const read of [() => saveStorage('session').getItem(KEY), () => saveStorage('device').getItem(BACKUP_KEY)]) {
    let raw: string | null = null;
    try { raw = read(); } catch { continue; }
    if (raw === null || valid(raw, slug) === null) continue;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) continue;
    const at: unknown = Reflect.get(value, 'at'), name: unknown = Reflect.get(value, 'name'), tier: unknown = Reflect.get(value, 'tier');
    if (typeof at === 'number') return { name: typeof name === 'string' ? name : undefined, tier: typeof tier === 'string' ? tier : undefined, at };
  }
  return null;
}
