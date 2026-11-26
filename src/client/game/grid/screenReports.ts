import { captureBrowserError } from '@wildshard/engine/telemetry/browserErrors';
import type { GridCrossingState } from '../../../shared/game/grid/crossing';
import { installedCatalogue } from '../../../shared/game/grid/catalogueSlot';
import type { CrossingSaveStatus } from './borderShimmer';

declare const __BUILD_ID__: string;
const buildId = (): string => { try { return __BUILD_ID__; } catch { return ''; } };

/**
 * SENTRY-TRIAGE S18: the grid's SAVE FAILED, RETRY at a border is a screen of a fault. The first time a session shows it, one
 * report names the cell the crossing left and the one it aimed for; later failures in the same session stay quiet, so an
 * offline player who keeps trying can't fill the screen outbox (8 kept) and push out an unsent error-modal.
 */
export function saveFailedReporter(slugOf: (instance: string | null) => string, capture: typeof captureBrowserError = captureBrowserError):
  (status: CrossingSaveStatus, state: GridCrossingState | null | undefined) => void {
  let reported = false;
  return (status, state) => {
    if (reported || status !== 'failed') return;
    reported = true;
    try {
      capture(new Error(`a border crossing could not save (SAVE FAILED, RETRY): ${state?.issue ?? state?.phase ?? 'unknown'}`), {
        system: 'grid', build: buildId(), shard: slugOf(state?.current ?? null), bootStage: 'playing', fatal: false, screen: 'save-failed',
        diagnostic: { phase: state?.phase ?? null, target: slugOf(state?.target ?? null) } });
    } catch { /* a report never holds the crossing */ }
  };
}

/** The installed catalogue's revision of `slug`, or null when the page has none (a test, a shell). */
export function catalogueRevision(slug: string): number | null {
  const heads = installedCatalogue()?.shards ?? [];
  return new Map(heads.map(head => [head.slug, head.uploadNumber])).get(slug) ?? null;
}

/** S18: a neighbour that can't load shows UNAVAILABLE on Shard Select. One report per cell a session, at warning level.
 *  SHARD-COMPAT NB9 (meta NEVER-BREAK-LIVE I7): one cell's failure stays in its cell. The report names the cell, the shard, its
 *  revision when the catalogue knows it, and this build, so a refused neighbour is traced without taking the page down. */
export function refusalReporter(capture: typeof captureBrowserError = captureBrowserError, revisionOf: (slug: string) => number | null = catalogueRevision):
  (instance: string, slug: string, refusal: string, error: unknown) => void {
  const seen = new Set<string>();
  return (instance, slug, refusal, error) => {
    if (seen.has(instance)) return;
    seen.add(instance);
    try {
      const revision = revisionOf(slug);
      capture(error instanceof Error ? error : new Error(String(error)), { system: 'grid', build: buildId(), shard: slug, bootStage: 'playing',
        fatal: false, screen: 'cell-unavailable', diagnostic: { refusal, cell: instance, ...revision === null ? {} : { revision } } });
    } catch { /* a report never holds the refusal */ }
  };
}
