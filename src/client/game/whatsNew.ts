import today from './whatsNew.json' with { type: 'json' };
/**
 * The day's WHAT'S NEW lines on the main menu (SHARD-PLATFORM SF60, Jake's pick G214: B, a slim banner under the logo;
 * `art/menu/round-12-whats-new/B-banner*.jpg`). The coordinator rewrites `whatsNew.json` beside this file at least once a
 * day: 3–5 short, true lines of what changed in the playable build on `main`, newest first, with `date` and `updated` set
 * to now. The pre-push gate (scripts/whats-new-fresh.mjs, E482) refuses a push to main once `updated` is more than 24 h
 * old, so a stale banner blocks every push until someone rewrites it. An empty `entries` list hides the banner.
 * The lines are data (they name shards, which game code never does, E405), typed here.
 *
 *   { "date": "17 OCT 2026", "updated": "2026-10-17T12:05:00-05:00", "entries": ["Nine Dragon: portal … again", …] }
 *
 * The banner (src/client/game/whatsNewBanner.ts) shows only with Settings ▸ Developer on, and HIDE UNTIL NEXT BUILD keeps it
 * folded away until the running build changes.
 */
export interface WhatsNew {
  /** the day the lines were written, as the banner's build line shows it ("7 OCT 2026"); optional */
  readonly date?: string;
  /** when the lines were last rewritten, ISO 8601 with a zone; the pre-push gate keeps it within 24 h (E482) */
  readonly updated: string;
  /** the lines, plain text, one change each */
  readonly entries: readonly string[];
}

export const WHATS_NEW: WhatsNew = today;
