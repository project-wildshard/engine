// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { ShardRows } from '@wildshard/format/rows';
import { NetClient } from '../src/client/engine/net/client';
import { SpeciesService, type SpeciesLook } from '../src/client/engine/entities/species/look';
import { speciesViewKinds } from '../src/client/game/shardfile/clientRecipes';
import { WirePage } from '../src/client/game/shardfile/wirePage';
import { Scope } from '../src/shared/engine/app/scope';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import { buildPlatformSpawns } from '../src/server/engine/ai/platform';
import { createSimHost } from '../src/server/engine/sim';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { speciesResolver } from '../src/server/game/plugin/brain';
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

test('each declared species reaches a remote page by its own id, and a native body by none', () => {
  const spawns = buildPlatformSpawns(SPAWNS.map(([id, speciesId, variant, x]) => ({ id, species: speciesId, variant, brain: null, strike: null, seed: 1, scale: 1, at: [x, 0, 4] as const, yaw: 0 })), speciesResolver(ROWS as ShardRows));
  const host = createSimHost({ ...SIM_LEVEL, entities: [...SIM_LEVEL.entities, ...spawns] }, { rapier }), link = directLoopback(), client = new NetClient(link.client);
  const room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  room.tick(); room.tick(); link.pump();
  const seen = new Map([...client.entities.values()].filter(info => info.cls.cls === ANIMAL_CLASS.cls).map(info => [info.id, [info.initial['kind'], info.initial['species']]]));
  expect(seen.get('bandit.1')).toEqual(['bear', 'mesa.bandit']);
  expect(seen.get('wyrm')).toEqual(['bear', 'mesa.wyrm']);
  expect(seen.get('target.1')).toEqual(['greyBlob', 'mesa.target']);
  const native = SIM_LEVEL.entities[0]?.id ?? '';
  expect(seen.get(native)?.[1], 'a native body names no species').toBe('');
  room.dispose(); host.dispose();
});

test('a page draws each species on a shared kind by its own look and name', () => {
  const kinds = speciesViewKinds(ROWS);
  expect(Object.fromEntries(kinds)).toEqual({ 'mesa.target': 'greyBlob', 'mesa.bandit': 'mesa.bandit', 'mesa.wyrm': 'mesa.wyrm' });
  // What the page's kit does: each row and look under its page kind (client.ts kitData).
  const level = new Scope('level'), service = new SpeciesService(() => level), page = new WirePage();
  page.declareSpecies(kinds, level);
  for (const row of ROWS.species) service.registerRow({ ...row, kind: kinds.get(row.id) ?? row.kind } as unknown as SpeciesRow, level);
  for (const look of ROWS.looks) {
    const row = ROWS.species.find(entry => entry.id === look.species);
    service.registerLook({ id: look.id, species: look.species, kind: kinds.get(look.species) ?? row?.kind ?? '', rig: 'custom', rigContract: { sockets: ['body', 'head'] } } as unknown as SpeciesLook, level);
  }
  // A row from the wire: kind `bear` for both, told apart by `species`.
  const bandit = service.get(page.rowKind('mesa.bandit', 'bear')), wyrm = service.get(page.rowKind('mesa.wyrm', 'bear'));
  expect([bandit?.label, (bandit as { id?: string } | undefined)?.id]).toEqual(['Tin bandit', 'mesa.bandit']);
  expect([wyrm?.label, (wyrm as { id?: string } | undefined)?.id]).toEqual(['Dust Wyrm', 'mesa.wyrm']);
  // A native body, an older server (no species), or a species this page doesn't know keeps the wire's kind.
  expect(page.rowKind('', 'bear')).toBe('bear');
  expect(page.rowKind(undefined, 'boar')).toBe('boar');
  expect(page.rowKind('mesa.target', 'greyBlob')).toBe('greyBlob');
  expect(page.rowKind('other.thing', 'bear')).toBe('bear');
  level.dispose();
  expect(page.rowKind('mesa.wyrm', 'bear'), 'the level gone, its kinds go with it').toBe('bear');
});
