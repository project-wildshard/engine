import type { Json } from '../saves/slots';
import { ERROR_SCREENS, OUTBOX_MAX, type BrowserErrorTags, type ScreenReport, type ScreenStore } from './browserErrors';
/**
 * SENTRY-TRIAGE S13: the screen outbox's reader and sender, loaded only when a report is owed (outside the title's gzip ceiling).
 * Every error screen's report waits on the device (browserErrors.ts reportScreen) until Sentry acknowledges it; a resend keeps its
 * event id, so Sentry keeps one event.
 */

const OUTBOX_AGE_MS = 7 * 24 * 60 * 60_000;

/** The outbox over a store. Pure: no SDK and no page. */
export class ScreenOutbox {
  private readonly store: ScreenStore;
  private readonly now: () => number;
  constructor(store: ScreenStore, now: () => number = Date.now) { this.store = store; this.now = now; }
  /** the reports still owed, oldest first: at most OUTBOX_MAX, none older than a week, nothing malformed */
  pending(): ScreenReport[] {
    let raw: Json = null;
    try { raw = this.store.read(); } catch { return []; }
    if (!Array.isArray(raw)) return [];
    const now = this.now();
    const owed: ScreenReport[] = [];
    for (const item of raw) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const { id, at, message, stack, tags } = item;
      if (typeof id !== 'string' || typeof at !== 'number' || now - at >= OUTBOX_AGE_MS || typeof message !== 'string' || typeof stack !== 'string') continue;
      if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) continue;
      const screen = ERROR_SCREENS.find((name) => name === tags['screen']);
      if (screen === undefined || typeof tags['system'] !== 'string' || typeof tags['bootStage'] !== 'string') continue;
      // every tag is a string or the fatal flag; the diagnostic is a plain object
      const sound = Object.entries(tags).every(([key, value]) => key === 'diagnostic'
        ? typeof value === 'object' && value !== null && !Array.isArray(value) : typeof value === 'string' || typeof value === 'boolean');
      if (sound) owed.push({ id, at, message, stack, tags: { ...(tags as unknown as BrowserErrorTags), screen } });
    }
    return owed.slice(-OUTBOX_MAX);
  }
  /** keep a report until it is acknowledged; false when storage refused it */
  add(report: ScreenReport): boolean {
    return this.save([...this.pending().filter((p) => p.id !== report.id), report]);
  }
  ack(id: string): void { this.save(this.pending().filter((p) => p.id !== id)); }
  private save(queue: readonly ScreenReport[]): boolean {
    const text = JSON.stringify(queue.slice(-OUTBOX_MAX));
    try { this.store.write(JSON.parse(text) as Json); return true; } catch { return false; }
  }
}

/** Send every owed report; an acknowledged one leaves the outbox. `deliver` resolves true on Sentry's 2xx. */
export async function flushScreenOutbox(outbox: ScreenOutbox, deliver: (error: Error, tags: BrowserErrorTags, eventId: string) => Promise<boolean>,
  inFlight: Set<string>): Promise<void> {
  for (const report of outbox.pending()) {
    // another flush may have delivered it while this one waited
    if (inFlight.has(report.id) || !outbox.pending().some((p) => p.id === report.id)) continue;
    inFlight.add(report.id);
    try {
      const error = new Error(report.message);
      if (report.stack !== '') error.stack = report.stack;
      if (await deliver(error, report.tags, report.id)) outbox.ack(report.id);
    } catch { /* kept for the next flush */ } finally { inFlight.delete(report.id); }
  }
}
