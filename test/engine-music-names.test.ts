// AUDIO AU18 (J304): a shard names the engine music it plays (title, `base` slots, extra stings) in its audio rows; the
// cook derives the hashed files from those names and refuses a name the engine's one style lacks.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the pinned products when this checkout has them.
import { existsSync, readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import type { AudioData } from '@wildshard/format/audio';
import { AudioMusicSchema } from '@wildshard/format/audioProfiles';
// shard-format exports the engine slot names (`./engineMusic`, v0.4.5); read the pinned copy so the two can't drift.
import { ENGINE_MUSIC_SLOTS } from '@wildshard/format/engineMusic';
import { engineMusicLine, shardBootAudio } from '../src/cook/game/entryTotals';
import { openShardfile, shardHalf } from '../src/cook/game/shardCook';
import { folderTarball } from '../src/cook/game/folderTarball';
import { ENGINE_MUSIC_STYLE, engineMusicFiles, engineMusicNames, musicManifest } from '../src/shared/engine/audio/bootAudio';
import { installAssetTables, type AssetTables } from '../src/shared/engine/boot/tables';
import { PUBLIC_BYTES } from '../src/client/game/boot/bytes.generated';
import { ASSET_VERSIONS } from '../src/client/game/boot/versions.generated';
import { MUSIC_MANIFESTS, SFX_MANIFESTS } from '../src/client/game/boot/audio.generated';

const tables: AssetTables = { bytes: PUBLIC_BYTES, versions: ASSET_VERSIONS, music: MUSIC_MANIFESTS, sfx: SFX_MANIFESTS, packs: {} };
installAssetTables(tables);
const piano = musicManifest(ENGINE_MUSIC_STYLE);
const dir = `/assets/music/${ENGINE_MUSIC_STYLE}/`;

// Driftwood's rows: its `island` slot is the engine style's (set `base`), and it boots the title.
const music = { id: 'driftwood', base: 'island', slots: ['island'], bootSlots: ['title', 'island'], controlTension: 'late', sets: { island: 'base' },
  catalogue: { mode: 'bank', extraStings: [], stingSets: {} } };
const samples = { bed: 'island', set: 'fixture-isle', loopGains: { island: 0.5 },
  catalogue: { inventoryOmitSlots: [], loopOrder: [], overlaySamples: true, ownMusic: false, priorityOwn: false } };
const level = (rows: Record<string, unknown>): AudioData => ({ music: { ...music, ...rows }, samples }) as unknown as AudioData;
const sections = (data: AudioData): Map<string, unknown> => new Map([['audio/audio', { audio: data }]]);

test('the engine style has exactly the slots shard-format admits, plus the title', () => {
  expect(Object.keys(piano?.slots ?? {}).sort()).toEqual([...ENGINE_MUSIC_SLOTS, 'title'].sort());
  const score = { id: 'x', base: 'harbor', slots: ['harbor'], bootSlots: ['title', 'harbor'], sets: { harbor: 'base' }, synthLead: 'pluck', minFade: 1,
    source: null, selection: [{ slots: ['harbor'], when: [] }], selectMode: 'first' };
  expect(v.safeParse(AudioMusicSchema, score).success).toBe(false);
});

test("Driftwood's derived engine music is the title, island calm and tension, and the stings", () => {
  const island = piano?.slots['island'], title = piano?.slots['title'];
  const want = [title?.calm, island?.calm, island?.tension, ...Object.values(piano?.stings ?? {})].map(file => `${dir}${file}`);
  expect(want.length).toBeGreaterThanOrEqual(6);
  expect(engineMusicNames(level({}).music!)).toEqual({ slots: ['title', 'island'], stings: [] });
  expect(engineMusicFiles(level({})).sort()).toEqual(want.sort());
  // The cook lists them, and the build log names them.
  const listed = shardBootAudio(sections(level({})), tables, [], 'driftwood-isle');
  expect(listed.filter(url => url.startsWith(dir)).sort()).toEqual(want.sort());
  expect(engineMusicLine('driftwood-isle', listed, tables)).toMatch(/^driftwood-isle: engine music: \d+ files, \d+\.\d\d MB \(.*title-/u);
});

test('the cook refuses a shard naming an engine slot or sting the style lacks', () => {
  const harbor = level({ base: 'harbor', slots: ['harbor'], bootSlots: ['title', 'harbor'], sets: { harbor: 'base' } });
  expect(() => shardBootAudio(sections(harbor), tables, [], 'fixture')).toThrow(/^fixture: .*piano style lacks: slot harbor$/u);
  // An extra sting with no set of its own is the engine's; one the style has no file for refuses.
  const missing = (['pickup', 'death', 'chunk', 'dawn'] as const).find(sting => piano?.stings[sting] === undefined);
  if (missing !== undefined) {
    const sting = level({ catalogue: { mode: 'slots', extraStings: [missing], stingSets: {} } });
    expect(() => shardBootAudio(sections(sting), tables, [], 'fixture')).toThrow(new RegExp(`sting ${missing}$`, 'u'));
    // Pine's `dawn` comes from its own set: not an engine name.
    const own = level({ catalogue: { mode: 'slots', extraStings: [missing], stingSets: { [missing]: 'pine-hollow' } } });
    expect(engineMusicNames(own.music!).stings).toEqual([]);
  } else expect(engineMusicNames(level({ catalogue: { mode: 'slots', extraStings: ['dawn'], stingSets: {} } }).music!).stings).toEqual(['dawn']);
  // A slots-mode score whose base slot is its own set takes its stings from that set: not engine names.
  expect(engineMusicNames(level({ base: 'own', slots: ['own'], sets: { own: 'pine-hollow' }, catalogue: { mode: 'slots', extraStings: ['dawn'], stingSets: {} } }).music!).stings).toEqual([]);
  // A slot played from the shard's own set is not an engine name; a score set plays only the engine title.
  expect(engineMusicNames(level({ base: 'pine', slots: ['pine', 'night'], bootSlots: ['title', 'pine'], sets: { pine: 'base', night: 'pine-hollow' } }).music!).slots).toEqual(['title', 'pine']);
  expect(engineMusicNames(level({ base: 'score', slots: ['score'], bootSlots: ['title'], sets: {}, setCatalogue: { inventory: 'title' } }).music!).slots).toEqual(['title']);
});

// The pinned products (`node scripts/pins.ts install`) and this build's boot table, when the checkout has them.
const bootTables = 'out/.app/boot-tables.json';
for (const [shard, slots] of [['driftwood-isle', ['title', 'island']], ['pine-hollow', ['title', 'pine']], ['nalati-grasslands', ['title']], ['nine-dragon-stack', ['title']]] as const) {
  test.skipIf(!existsSync(`out/${shard}/shard.json`) || !existsSync(bootTables))(`${shard}: its rows name engine music the build has`, () => {
    const common = JSON.parse((JSON.parse(readFileSync(bootTables, 'utf8')) as { common: string }).common) as AssetTables;
    const half = shardHalf(openShardfile(folderTarball(`out/${shard}`)), (_url, bytes) => bytes.length);
    const row = half.shard.sections.get('audio/audio') as { audio: AudioData };
    expect(engineMusicNames(row.audio.music!).slots).toEqual(slots);
    expect(() => shardBootAudio(half.shard.sections, common, [], shard)).not.toThrow();
  });
}
