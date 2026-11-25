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
/** LS6: arrival art is a same-origin asset path or empty (none), never a URL a stored value could point elsewhere. */
const ARRIVAL_ART = /^(?:\/(?!\/)[\w./-]+\.(?:jpg|png|webp))?$/u;
export function arrivalArt(value: unknown): value is string { return typeof value === 'string' && ARRIVAL_ART.test(value); }

/** CP1: `from` is the writing document's start, `taken` the start of the one other document that took it (see `ours`). */
interface StoredArrival extends TitleArrival { at: number; name?: string; tier?: string; art?: string; timing?: Readonly<Record<string, unknown>>; from?: number; taken?: number }

/** CP1: a document's identity, its start (`performance.timeOrigin`): one per document, the same in every module of it. */
function ownDocument(): number { return typeof performance === 'undefined' ? 0 : performance.timeOrigin; }
/** CHUNK-PARAM CP1 (J522): whose tap a record is, now that a bare `/` can take one. The document that wrote it, or the first other
 *  document to read it: the one the tap navigated (index.html's first paint stamps `taken` before any module runs). A later page in
 *  the tab (the title after an exit while loading, a player's reload) finds it taken by another document and leaves it. */
function ours(candidate: Partial<StoredArrival>, own: number): boolean {
  return candidate.taken === undefined || candidate.taken === own || candidate.from === own;
}

/** A one-shot handoff must be fresh when this document arrives, before cold
 * modules or world admission run. Later reloads still use their own start.
 * Explicit clocks keep expiry and delayed-consumption checks deterministic. */
export function freshPageArrival(at: number, now: number = Date.now(), startedAt: number = typeof window === 'undefined' ? now : performance.timeOrigin): boolean {
  if (![at, now, startedAt].every(Number.isFinite) || at > now || startedAt > now) return false;
  return now - at <= MAX_AGE_MS || (startedAt >= at && startedAt - at <= MAX_AGE_MS);
}

/** CHUNK-PARAM CP1 (J522): a zone's slug as the tap stored it; the address no longer names one, so the record does. */
const ZONE = /^[a-z0-9_-]+$/u;

function valid(raw: string | null, slug?: string): TitleArrival | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as Partial<StoredArrival>;
    const zone = candidate.slug ?? '';
    if (!ZONE.test(zone) || ![slug ?? zone].includes(zone) || (candidate.mode !== 'enter' && candidate.mode !== 'explore' && candidate.mode !== 'arena')) return null;
    if (typeof candidate.at !== 'number' || !freshPageArrival(candidate.at) || !ours(candidate, ownDocument())) return null;
    const timing = bootTiming();
    if (timing !== undefined && candidate.timing !== undefined) timing.handoff = {
      ...candidate.timing, wall: candidate.at, received: timing.handoff?.['received'] ?? diagnosticNow(), newTimeOrigin: timing.timeOrigin,
      source: 'validated-title-arrival', validated: true, validatedAt: diagnosticNow(),
    };
    return { slug: zone, mode: candidate.mode };
  } catch { return null; }
}

/** CP1: the device copy (kept for iOS's WebContent swap, which loses the tab's session) belongs to the document the tap
 *  navigated: a plain navigation from this origin (the title, or the leave page it went through). Another tab's `/`, a
 *  bookmark or a reload inside the minute has no same-origin referrer or is no navigation, so it never takes the tap.
 *  With no page (node tests, workers) there is no other tab to guard against. */
export function tapNavigatedHere(page: { readonly referrer: string; readonly origin: string; readonly type: string | undefined } | undefined = currentPage()): boolean {
  if (page === undefined) return true;
  if (page.type !== undefined && page.type !== 'navigate') return false;
  try { return page.referrer !== '' && new URL(page.referrer).origin === page.origin; } catch { return false; }
}
function currentPage(): { referrer: string; origin: string; type: string | undefined } | undefined {
  if (typeof document === 'undefined' || typeof location === 'undefined') return undefined;
  let type: string | undefined;
  try { const nav: unknown = performance.getEntriesByType('navigation')[0]; const named: unknown = typeof nav === 'object' && nav !== null ? Reflect.get(nav, 'type') : undefined; type = typeof named === 'string' ? named : undefined; } catch { type = undefined; }
  return { referrer: document.referrer, origin: location.origin, type };
}
/** CP1: a document other than the writer takes a fresh record it reads, so no later document in the tab can. */
function claim(kept: 'session' | 'device', key: string, raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw), own = ownDocument();
    if (typeof value !== 'object' || value === null || Reflect.get(value, 'taken') !== undefined || Reflect.get(value, 'from') === own) return raw;
    const taken = JSON.stringify({ ...value, taken: own });
    saveStorage(kept).setItem(key, taken);
    return taken;
  } catch { return raw; }
}
function deviceBackup(take: boolean): string | null {
  if (!tapNavigatedHere()) return null;
  try {
    const raw = saveStorage('device').getItem(BACKUP_KEY);
    if (take) saveStorage('device').removeItem(BACKUP_KEY);
    return raw;
  } catch { return null; }
}

/** Optional display metadata lets the first HTML paint name the destination before application modules arrive. */
/** LS6: `art` is the destination's own placeholder art (a same-origin path), or '' for none: the card's first frame shows it. */
/** `tab`: a page reloading itself (QA row 16) hands the tap to its own next document only, never to another tab's bookmark. */
export function setTitleArrival(arrival: TitleArrival & { name?: string; tier?: string; art?: string }, options: { readonly tab?: boolean } = {}): void {
  bootMark('app:navigation-decision', {slug: arrival.slug});
  const timing = bootTiming();
  const raw = JSON.stringify({ ...arrival, at: Date.now(), from: ownDocument(), ...(timing === undefined ? {} : {timing: {
    timeOrigin: timing.timeOrigin, decision: diagnosticNow(), input: Reflect.get(timing, 'lastInput'), attempt: timing.attempt,
  }}) } satisfies StoredArrival);
  try { saveStorage('session').setItem(KEY, raw); } catch { /* the local one-shot below can carry the intent */ }
  // iOS home-screen navigation can replace WebContent between the static title and the game document.
  // The backup is consumed once, and expires quickly; it never becomes a remembered last shard.
  if (options.tab !== true) try { saveStorage('device').setItem(BACKUP_KEY, raw); } catch { /* the session copy may still survive */ }
}

/** A tab's own handoff (`setTitleArrival(…, {tab: true})`) whose reload did not happen. */
export function dropTabArrival(): void {
  try { saveStorage('session').removeItem(KEY); } catch { /* nothing was kept */ }
}

/** The tap this document arrived with, consumed (both copies): the zone it names, or, given `slug`, only a tap for that zone. */
export function consumeTitleArrival(slug?: string): TitleArrival | null {
  let session: string | null = null;
  try { session = saveStorage('session').getItem(KEY); saveStorage('session').removeItem(KEY); } catch { /* use the backup */ }
  const backup = deviceBackup(true);
  return valid(session, slug) ?? valid(backup, slug);
}

/** Inspect the same fresh one-shot arrival without consuming the receiving session's handoff (CP1: with no `slug`, whatever zone it names). */
export function pendingTitleArrival(slug?: string): TitleArrival | null {
  let session: string | null = null;
  try { session = saveStorage('session').getItem(KEY); } catch { /* the backup may survive */ }
  if (valid(session, slug) !== null) return valid(claim('session', KEY, session), slug);
  const backup = deviceBackup(false);
  return valid(backup, slug) === null ? null : valid(claim('device', BACKUP_KEY, backup), slug);
}

/** DL21: the fresh arrival's display facts and tap time for the receiving document's first card, without consuming it. */
export function arrivalCard(slug: string): { name: string | undefined; tier: string | undefined; art: string | undefined; at: number } | null {
  for (const read of [() => saveStorage('session').getItem(KEY), () => deviceBackup(false)]) {
    let raw: string | null = null;
    try { raw = read(); } catch { continue; }
    if (raw === null || valid(raw, slug) === null) continue;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) continue;
    const at: unknown = Reflect.get(value, 'at'), name: unknown = Reflect.get(value, 'name'), tier: unknown = Reflect.get(value, 'tier'), art: unknown = Reflect.get(value, 'art');
    if (typeof at === 'number') return { name: typeof name === 'string' ? name : undefined, tier: typeof tier === 'string' ? tier : undefined,
      art: arrivalArt(art) ? art : undefined, at };
  }
  return null;
}
