// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { classifyRefusal, refusalReason, shardRefusals } from '../src/client/game/grid/refusal';
import { catalogueRevision, refusalReporter } from '../src/client/game/grid/screenReports';
import { installCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { titleCard } from '../src/client/game/titleDeck';
import type { TitleManifest } from '../src/client/game/shard/titleList';
import type { BrowserErrorTags } from '../src/client/engine/telemetry/browserErrors';
import { GAME_STRINGS } from '../src/shared/game/strings';
import { saves } from '@wildshard/engine/saves/runtime';

/**
 * SHARD-COMPAT NB9 (meta NEVER-BREAK-LIVE I7): one cell's failure stays in its cell. The duneRay night ended the whole page on a
 * neighbour's row; NB1 made a page skip rows it can't draw. Here a cell whose admission throws (forced: the duneRay error itself)
 * is a refusal, not a page fault: `GridSession.refuse` notes it for that cell (its soft wall stays shut, its loading screen gives
 * the reason), reports it once at warning level naming the cell, shard, revision and build, and Shard select dims only that card
 * while every other zone still enters.
 */
const ART = { thumb: '', portrait: '', landscape: '' };
const row = (slug: string, name: string): TitleManifest => ({ slug, name, biome: name, status: 'live', card: ART });
afterEach(() => { installCatalogue({ placements: [], grid: { cells: [] } }); });

test('NB9: a forced cell failure is that cell\'s refusal, reported once with its cell, shard and revision, never fatal', () => {
  const forced = new Error("unknown animal kind 'duneRay'");
  expect(classifyRefusal(forced), 'a load error that is not a wait refuses the cell').toBe('safety');
  installCatalogue({ placements: [], grid: { cells: [{ instance: 'dunes-1', slug: 'sunscar-dunes' }] }, shards: [{ slug: 'sunscar-dunes', name: 'Signal Dunes', revision: 6, hash: 'a'.repeat(64) }] });
  expect(catalogueRevision('sunscar-dunes')).toBe(6);
  const reports: { error: unknown; tags: BrowserErrorTags }[] = [];
  const report = refusalReporter((error, tags) => { reports.push({ error, tags }); });
  report('dunes-1', 'sunscar-dunes', 'safety', forced);
  report('dunes-1', 'sunscar-dunes', 'safety', forced);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.tags).toMatchObject({ system: 'grid', shard: 'sunscar-dunes', fatal: false, screen: 'cell-unavailable', diagnostic: { refusal: 'safety', cell: 'dunes-1', revision: 6 } });
  expect(typeof reports[0]?.tags.build).toBe('string');
});

test('NB9: Shard select dims only the refused shard; the title and every other zone still enter', () => {
  const refusals = shardRefusals(saves);
  refusals.note('sunscar-dunes', classifyRefusal(new Error("unknown animal kind 'duneRay'")) ?? 'load');
  const opens = (): boolean => true, noUpgrade = (): null => null;
  const cards = [row('sunscar-dunes', 'Signal Dunes'), row('driftwood-isle', 'Driftwood Isle'), row('pine-hollow', 'Pine Hollow')]
    .map(manifest => titleCard(manifest, noUpgrade, refusals.read, opens));
  expect(cards.map(card => [card.slug, card.unavailable ?? null])).toEqual([['sunscar-dunes', 'safety'], ['driftwood-isle', null], ['pine-hollow', null]]);
  expect(refusalReason('safety')).toBe(GAME_STRINGS.unavailable.safety);
  refusals.clear('sunscar-dunes');
  expect(refusals.read('sunscar-dunes'), 'a fresh launch tries the shard again').toBeNull();
});
