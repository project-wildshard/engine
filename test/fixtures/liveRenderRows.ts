// ZONE-SNAPSHOTS ZS9 (J507): Nalati's live render rows (the mounted figure, the painted shape book and the grass field)
// and their files, read from the live pin.
import { parse, array, object, looseObject, string } from 'valibot';
import { FixedDrawRowsSchema } from '@wildshard/format/fixedDraws';
import { MountedSpecimenSeatSchema } from '@wildshard/format/mountedSpecimenRows';
import { GrassPresentationSchema, type GrassPresentationRows } from '@wildshard/format/fieldPresentation';
import { fixedDraws } from '../../src/client/game/models/fixedDraws';
import { liveBytes, liveJson, liveNames } from './livePin';
const NALATI = 'nalati-grasslands';
export const MOUNTED_FIGURE = parse(MountedSpecimenSeatSchema, liveJson(NALATI, 'riding/mounted-figure.json'));
const book = parse(FixedDrawRowsSchema, liveJson(NALATI, 'models/shape-book.json'));
const files = parse(array(looseObject({file: string()})), book.filter(row => 'file' in row)).map(row => row.file);
/** The painted shapes the shape book names by file, by their product names. */
export const SHAPE_BYTES = new Map(files.map(name => [name, liveBytes(NALATI, name)] as const));
const named = book.find(row => 'file' in row);
if (named === undefined) throw new Error('Nalati names no painted shape');
export const SHAPES = fixedDraws({slug: 'nalati-shapes', file: name => {
  const bytes = SHAPE_BYTES.get(name);
  if (bytes === undefined) throw new Error(`Missing live shape: ${name}`);
  return Promise.resolve(bytes);
}}, [{...named, slot: 'fixture.shape'}]);
await SHAPES.load();
const post = parse(object({painted: object({grass: object({rows: GrassPresentationSchema})})}), liveJson(NALATI, 'look/post.json'));
export const GRASS_ROWS: GrassPresentationRows = post.painted.grass.rows;
export const GRASS_FILES = new Map(liveNames(NALATI).filter(name => name.startsWith('look/grass/')).map(name => [name, liveBytes(NALATI, name)] as const));
