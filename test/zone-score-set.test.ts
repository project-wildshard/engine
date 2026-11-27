// SF23 (meta standalone shardfiles): the engine's island and pine slots retire, so a zone that played them carries its own
// copy as a slot set named for its slug (`sets: { pine: '<slug>' }`, `/assets/<slug>/music/<slug>-piano/`). A page built
// with the zone reads that set from its tables; a zone-table page adopts it from the zone's cook before the slot decodes.
import { afterEach, expect, test, vi } from 'vitest';
import type { AudioData } from '@wildshard/format/audio';
import { CatalogueScore } from '../src/client/engine/audio/SetScore';
import { decodeStyle } from '../src/client/engine/audio/Stems';
import { ZONE_DIR, useZoneScoreSetAdoption, zoneScoreSet } from '../src/shared/engine/boot/zoneAssets';
import { installAssetTables } from '../src/shared/engine/boot/tables';

const slot = { calm: 'pine-calm-923e0056.m4a', tension: 'pine-tension-cc014e5b.m4a', bpm: 91.998, beatsPerBar: 4,
  loopStart: 6.757, loopEnd: 58.9322, duration: 61.5467 };
const own = { slots: { pine: slot }, stings: { pickup: 'sting-pickup-5ba19a30.m4a' } };
const piano = { slots: { title: { ...slot, calm: 'title-7ce82663.m4a', tension: undefined } }, stings: {} };
const music = { genre: 'piano' as const, state: { mode: 'calm' as const, intensity: 0, underwater: false, lead: 'pluck' as const },
  refreshScore: vi.fn(), combat: vi.fn(), sting: vi.fn() };
const score = (sets: Record<string, string>): NonNullable<AudioData['music']> => ({ id: 'score.mossgate', base: 'pine',
  slots: ['pine', 'island', 'title'], bootSlots: ['pine'], synthLead: 'pluck', minFade: 0, source: null, sets, selectMode: 'first',
  selection: [{ slots: ['pine'], when: [] }], catalogue: { mode: 'slots', extraStings: [], stingSets: {} },
  lifecycle: { persistent: false, dispose: true, logChanges: false } });

afterEach(() => { useZoneScoreSetAdoption(() => Promise.resolve()); });

test("a zone's slot set is its slug's folder under its own name; base and non-slugs are none", () => {
  expect(zoneScoreSet('mossgate', 'piano')).toEqual({ dir: '/assets/mossgate/music/mossgate-piano/', manifestKey: 'mossgate-piano' });
  expect(zoneScoreSet('base', 'piano')).toBeNull();
  for (const set of ['Moss', 'a--b', '../x', '']) expect(zoneScoreSet(set, 'piano')).toBeNull();
});

test("a slot whose set is the zone's slug decodes the zone's copy, with the set's stings", async () => {
  const dir = '/assets/mossgate/music/mossgate-piano/';
  const files = [`${dir}${slot.calm}`, `${dir}${slot.tension}`, `${dir}${own.stings.pickup}`];
  installAssetTables({ music: { piano, 'mossgate-piano': { ...own, [ZONE_DIR]: dir } }, bytes: Object.fromEntries(files.map(url => [url, 4])),
    versions: {}, sfx: {}, packs: {} });
  const reads: string[] = [];
  const bank = await decodeStyle('piano', ['pine'], url => { reads.push(url); return Promise.resolve(new ArrayBuffer(4)); },
    () => Promise.resolve({ duration: slot.duration } as AudioBuffer), undefined, 'mossgate');
  expect(reads.sort()).toEqual([...files].sort());
  expect(bank.slots.get('pine')?.spec).toMatchObject(slot);
  expect([...bank.stings.keys()]).toEqual(['pickup']);
});

test("a page lacking the zone's set adopts it from the zone's cook before the slot decodes", async () => {
  installAssetTables({ music: { piano }, bytes: {}, versions: {}, sfx: {}, packs: {} });
  const adopt = vi.fn(() => Promise.resolve());
  useZoneScoreSetAdoption(adopt);
  new CatalogueScore(music, score({ pine: 'mossgate', island: 'mossgate' })).want(undefined);
  await vi.waitFor(() => { expect(adopt).toHaveBeenCalledWith({ dir: '/assets/mossgate/music/mossgate-piano/', manifestKey: 'mossgate-piano' }); });
});

test('an engine slot, or a set the tables already hold, adopts nothing', async () => {
  installAssetTables({ music: { piano, 'mossgate-piano': { ...own, [ZONE_DIR]: '/assets/mossgate/music/mossgate-piano/' } }, bytes: {},
    versions: {}, sfx: {}, packs: {} });
  const adopt = vi.fn(() => Promise.resolve());
  useZoneScoreSetAdoption(adopt);
  const held = new CatalogueScore(music, score({ pine: 'mossgate' })), engine = new CatalogueScore(music, { ...score({}), base: 'title' });
  held.want(undefined);
  engine.want(undefined);
  await new Promise(resolve => { setTimeout(resolve, 50); });
  expect(adopt).not.toHaveBeenCalled();
});
