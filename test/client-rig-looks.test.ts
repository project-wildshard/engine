// ONE-FORMAT OF19d2: a declared look whose recipe is `platform.rig` draws its body from the named scene model library's
// rig (format 0.50.0, OF19d1), so a page needs no species program to draw rigged bodies (Sunscar Dunes).
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { RIG_LOOK_RECIPE } from '@wildshard/format/rigLooks';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';
import { clientSpeciesLooks } from '../src/client/game/shardfile/clientRecipes';

const dims = { bodyY: 1, bodyHalfLen: 1, bodyRadius: 0.5, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.5 };
const variant = { id: 'dusk', label: 'Dusk', weight: 1, rarity: 'common', scale: [1, 1], hp: 10,
  mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 0, relentless: false } };
const species = (id: string, kind: string): unknown => ({ id, kind, label: id, aggressive: false, lockable: true, dims, variants: [variant] });
const look = (id: string, speciesId: string, parameters: Record<string, string>): unknown =>
  ({ id, species: speciesId, recipe: RIG_LOOK_RECIPE, material: null, parameters, animation: { recipe: RIG_LOOK_RECIPE, parameters: {} } });
const rows = (looks: readonly unknown[]): ReturnType<typeof parseRows> => parseRows({ strikes: [], weather: [], days: [], compendiums: [], loot: [],
  species: [species('sunscar.ray', 'duneRay'), species('sunscar.big', 'duneMatriarch')], looks });
/** A library rig look: the rig's own build and animate, keyed by its kind. */
const rigged = (kind: string): SpeciesLook => ({ id: `rig.${kind}`, species: kind, kind, rig: 'custom' } as unknown as SpeciesLook);
const library = new Map([['models', [rigged('duneRay'), rigged('duneMatriarch'), rigged('duneStrider')]]]);

test('a platform.rig look draws the library rig of its species kind, or the body it names', () => {
  const looks = clientSpeciesLooks(rows([look('look.ray', 'sunscar.ray', { library: 'models' }),
    look('look.big', 'sunscar.big', { library: 'models', body: 'duneStrider' })]), new Map(), new Map(), new Map(), library);
  expect(looks.map((row) => [row.id, row.species, row.kind, row.rig])).toEqual([
    ['look.ray', 'sunscar.ray', 'duneRay', 'custom'], ['look.big', 'sunscar.big', 'duneMatriarch', 'custom']]);
});

test('a platform.rig look refuses an unloaded library or a body the library lacks', () => {
  expect(() => clientSpeciesLooks(rows([look('look.ray', 'sunscar.ray', { library: 'other' })]), new Map(), new Map(), new Map(), library))
    .toThrow('Unloaded rig library other');
  expect(() => clientSpeciesLooks(rows([look('look.ray', 'sunscar.ray', { library: 'models', body: 'duneWyrm' })]), new Map(), new Map(), new Map(), library))
    .toThrow('Rig library models has no body duneWyrm');
});
