// ZONE-SNAPSHOTS ZS9 (J507): Nalati's live geography: its discovery rows (ground, pigment, surface, map palette), its
// population field (world/meadow.json) and its scalar blocks (data/geography-*.bin), all from the live pin. The map
// channels' lattice rows are written here by hand on the field's own resolution and size.
import * as v from 'valibot';
import { liveBytes, liveJson, liveMount, liveNames } from './livePin';
const NALATI = 'nalati-grasslands';
const discovery = v.parse(v.looseObject({rows: v.looseObject({groundRows: v.unknown(), groundColourSamples: v.unknown(), surfaceSamples: v.unknown(), mapPalette: v.unknown()})}),
  liveMount(NALATI, 'shardfiles/nalati-grasslands/discovery.json')).rows;
/** Nalati's population field as it ships (seed, world rasters, trails, river, meadow). */
export const livePopulationField = liveJson(NALATI, 'world/meadow.json');
const field = v.parse(v.looseObject({seed: v.number(), world: v.looseObject({res: v.number(), size: v.number()})}), livePopulationField);
const lattice = (name: string) => ({res: field.world.res, size: field.world.size, values: {type: 'f32', count: field.world.res ** 2, data: {file: `data/geography-${name}.bin`}}});
/** The geography rows the CI21 extract carried, from the live product. */
export const liveGeographyRows = {res: field.world.res, size: field.world.size, seed: field.seed, map: discovery.mapPalette,
  ground: discovery.groundRows, pigment: discovery.groundColourSamples, surface: discovery.surfaceSamples,
  channels: {wet: lattice('wet'), forest: lattice('forest'), mapRed: lattice('mapRed'), mapGreen: lattice('mapGreen'), mapBlue: lattice('mapBlue')}};
/** One of Nalati's live scalar blocks by its product name (`data/geography-wet.bin`), fresh bytes. */
export function liveGeographyBlock(file: string): Uint8Array { return liveBytes(NALATI, file); }
export function liveGeographyBlocks(): ReadonlyMap<string, Uint8Array> {
  return new Map(liveNames(NALATI).filter(name => name.startsWith('data/geography-')).map(name => [name, liveBytes(NALATI, name)] as const));
}
