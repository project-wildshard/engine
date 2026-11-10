/**
 * What the main menu's WHAT'S NEW box says (SHARD-PLATFORM SF60, Jake's pick G214: B, a slim banner under the logo). Jake,
 * 2026-11-10: "The box, the changelog box, let's show the version of the engine", and every engine version tag carries a
 * changelog. So the box names this build's engine version and lists that version's section of CHANGELOG.md: one to five
 * plain-language bullets, which the pre-push hook and CI require before a version can ship (scripts/changelog.mjs).
 * vite.config.ts bakes the section in as `__ENGINE_RELEASE__`; there is no other copy. An empty list hides the box.
 *
 * The banner (src/client/game/whatsNewBanner.ts) shows only with Settings ▸ Developer on, and HIDE UNTIL NEXT BUILD keeps it
 * folded away until the running build changes.
 */
export interface WhatsNew {
  /** the engine version, "0.1.5" ('' when the build has none) */
  readonly version: string;
  /** the version's date, ISO "2026-11-10" ('' when unknown) */
  readonly date: string;
  /** the version's changelog bullets, plain text, one change each */
  readonly entries: readonly string[];
}

/** vite.config.ts: package.json's version and its CHANGELOG.md section; absent under Node */
declare const __ENGINE_RELEASE__: { readonly version: string; readonly date: string; readonly notes: readonly string[] };

/** This build's engine version and its changelog; empty under a unit test. */
export function engineWhatsNew(): WhatsNew {
  if (typeof __ENGINE_RELEASE__ !== 'object') return { version: '', date: '', entries: [] };
  return { version: __ENGINE_RELEASE__.version, date: __ENGINE_RELEASE__.date, entries: __ENGINE_RELEASE__.notes };
}

export const WHATS_NEW: WhatsNew = engineWhatsNew();
