// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { ShardRows } from '@wildshard/format/rows';
import { NetClient } from '../src/client/engine/net/client';
import { SpeciesService, type SpeciesLook } from '../src/client/engine/entities/species/look';
import { pageSpecies, speciesViewKinds } from '../src/client/game/shardfile/clientRecipes';
import { WirePage } from '../src/client/game/shardfile/wirePage';
import { Scope } from '../src/shared/engine/app/scope';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import { createSimHost } from '../src/server/engine/sim';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { emptyShardfile } from '../src/shared/host/author';
import type { Shardfile } from '../src/shared/host/shardfile';
import type { SpeciesRow } from '../src/server/engine/ai/species';
import { directLoopback } from '../src/test/engine/netLoopback';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// TE-ENG7: Brasscap's tin bandit and Dust Wyrm both take native kind `bear`. Online, a remote page spawned each row by
// `kind`, and the species service resolves a kind to its last row, so every bandit drew as the Wyrm. The row now carries
// its declared species id, and the page registers each species that shares a kind under a page kind of its own.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const DIMS = { bodyHalfLen: 0.3, bodyRadius: 0.36, bodyY: 0.62, feet: [], halfWidth: 0.36, headRadius: 0.22, legLen: 0.42 };
const MODS = { chargeDamage: 0, chargeDist: 1, damageTaken: 1, relentless: false, speed: 1 };
const species = (id: string, kind: string, variant: string, label: string): ShardRows['species'][number] => ({ id, kind, label, aggressive: true, lockable: true, dims: DIMS,
  variants: [{ id: variant, label, hp: 10, mods: MODS, rarity: 'common', scale: [1, 1], weight: 1 }] } as unknown as ShardRows['species'][number]);
/** A rows-only shard: a target on its own kind, and two species on one kind, each with its own look. */
const ROWS = {
  species: [species('mesa.target', 'greyBlob', 'tin', 'Tin target'), species('mesa.bandit', 'bear', 'tin', 'Tin bandit'), species('mesa.wyrm', 'bear', 'dust', 'Dust Wyrm')],
  looks: [{ id: 'look.bandit', species: 'mesa.bandit' }, { id: 'look.wyrm', species: 'mesa.wyrm' }],
} as unknown as Pick<ShardRows, 'species' | 'looks'>;
const SPAWNS = [['bandit.1', 'mesa.bandit', 'tin', 2], ['wyrm', 'mesa.wyrm', 'dust', -2], ['target.1', 'mesa.target', 'tin', 6]] as const;

/** A rows-only shard: its species, and one spawn of each. */
function rowsOnly(): Shardfile {
  const shard = emptyShardfile({ slug: 'species-wire', name: 'Species wire', author: 'Test', revision: 1, seed: 1 });
  return { ...shard, rows: { ...shard.rows, species: [...ROWS.species] },
    creatures: { ...shard.creatures, spawns: SPAWNS.map(([id, species, variant, x]) => ({ id, species, variant, brain: null, strike: null, seed: 1, scale: 1, at: [x, 0, 4] as [number, number, number], yaw: 0 })) } } as Shardfile;
}

test('each declared species reaches a remote page by its own id', () => {
  const sim = createShardfileSim(rowsOnly(), new Map(), { rapier }), { host } = sim, link = directLoopback(), client = new NetClient(link.client);
  const room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  try {
    room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
    room.tick(); room.tick(); link.pump();
    const seen = new Map([...client.entities.values()].filter(info => info.cls.cls === ANIMAL_CLASS.cls).map(info => [info.id, [info.initial['kind'], info.initial['species']]]));
    expect(seen.get('bandit.1')).toEqual(['bear', 'mesa.bandit']);
    expect(seen.get('wyrm')).toEqual(['bear', 'mesa.wyrm']);
    expect(seen.get('target.1')).toEqual(['greyBlob', 'mesa.target']);
  } finally { room.dispose(); host.dispose(); }
});

test('a native body names no species, and a declared save restores with its species', () => {
  const native = createSimHost(SIM_LEVEL, { rapier });
  expect([...native.entities.values()].map(body => body.species)).toEqual(SIM_LEVEL.entities.map(() => ''));
  native.dispose();
  // The species is not in the level, so a save from before TE-ENG7 keeps its fingerprint.
  const first = createShardfileSim(rowsOnly(), new Map(), { rapier }), saved = snapshotSimHost(first.host);
  expect(JSON.stringify(first.host.level)).not.toContain('mesa.bandit');
  const target = prepareShardfileSimRestore(rowsOnly(), new Map(), { rapier });
  try {
    target.restore(saved);
    expect(target.host.entities.get('wyrm')?.species).toBe('mesa.wyrm');
    expect(target.host.entities.get('bandit.1')?.species).toBe('mesa.bandit');
  } finally { target.host.dispose(); first.host.dispose(); }
});

test('a page draws each species on a shared kind by its own look and name, and an older server\'s rows as before', () => {
  const kinds = speciesViewKinds(ROWS);
  expect(Object.fromEntries(kinds)).toEqual({ 'mesa.target': 'greyBlob', 'mesa.bandit': 'mesa.bandit', 'mesa.wyrm': 'mesa.wyrm' });
  // What the page's kit does (client.ts kitData): every row and look through `pageSpecies`.
  const level = new Scope('level'), service = new SpeciesService(() => level), page = new WirePage();
  page.declareSpecies(kinds, level);
  for (const row of pageSpecies(ROWS.species, kinds)) service.registerRow(row as unknown as SpeciesRow, level);
  const looks = ROWS.looks.map(look => ({ id: look.id, species: look.species, kind: ROWS.species.find(row => row.id === look.species)?.kind ?? '', rig: 'custom', rigContract: { sockets: ['body', 'head'] } }));
  for (const look of pageSpecies(looks, kinds)) service.registerLook(look as unknown as SpeciesLook, level);
  // A row from the wire: kind `bear` for both, told apart by `species`.
  const bandit = service.get(page.rowKind('mesa.bandit', 'bear')), wyrm = service.get(page.rowKind('mesa.wyrm', 'bear'));
  expect([bandit?.label, (bandit as { id?: string } | undefined)?.id]).toEqual(['Tin bandit', 'mesa.bandit']);
  expect([wyrm?.label, (wyrm as { id?: string } | undefined)?.id]).toEqual(['Dust Wyrm', 'mesa.wyrm']);
  // An older server names no species: the row keeps the wire's kind, which still resolves, as it did before TE-ENG7.
  expect(page.rowKind(undefined, 'bear')).toBe('bear');
  expect(service.get('bear')?.label).toBe('Dust Wyrm');
  // A native body, or a species this page doesn't know, keeps the wire's kind too.
  expect(page.rowKind('', 'boar')).toBe('boar');
  expect(page.rowKind('mesa.target', 'greyBlob')).toBe('greyBlob');
  expect(page.rowKind('other.thing', 'bear')).toBe('bear');
  level.dispose();
  expect(page.rowKind('mesa.wyrm', 'bear'), 'the level gone, its kinds go with it').toBe('bear');
});
