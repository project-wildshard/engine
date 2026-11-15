import { parse, array, object, string, number, record, unknown } from 'valibot';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FixedDrawRowsSchema } from '@wildshard/format/fixedDraws';
import { MountedSpecimenSeatSchema } from '@wildshard/format/mountedSpecimenRows';
import { GrassPresentationSchema, type GrassPresentationRows } from '@wildshard/format/fieldPresentation';
import { sha256 } from '../../../src/shared/game/plugin/moduleHash';
import { fixedDraws } from '../../../src/client/game/models/fixedDraws';
import { frozenNalatiJson, frozenNalatiBytes } from './nalati';
import { frozenRuntimeJson } from './snapshots';
const seat = frozenRuntimeJson('mounted-figure.json'), shapePins = frozenRuntimeJson('shape-pins.json');
const grass = parse(object({rows: unknown(), files: record(string(), object({file: string(), bytes: number(), sha256: string()}))}), frozenRuntimeJson('grass.json'));

export const MOUNTED_FIGURE = parse(MountedSpecimenSeatSchema, seat);
const book = parse(object({sources: array(object({name: string(), source: string()})), draws: FixedDrawRowsSchema}), frozenNalatiJson('nalati-shape-book-original.json'));
const pins = parse(array(object({path: string(), bytes: number(), sha256: string()})), shapePins);
const bank = frozenNalatiBytes('nalati-poi-shapes-original.bin'), blocks = new Map<string, Uint8Array>();
let offset = 0;
for (let index = 0; index < 14; index++) {
  const file = `data/poi-shape-${index}.bin`, pin = pins.find(row => row.path.endsWith(`/${file}`));
  if (pin === undefined) throw new Error(`Missing frozen shape pin: ${file}`);
  const bytes = bank.slice(offset, offset + pin.bytes); offset += pin.bytes;
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Frozen shape differs: ${file}`);
  blocks.set(file, bytes);
}
if (offset !== bank.length) throw new Error('Frozen shape extent differs');
export const SHAPE_BYTES = new Map(book.sources.map(row => {
  const bytes = blocks.get(row.source);
  if (bytes === undefined) throw new Error(`Missing frozen shape: ${row.source}`);
  return [row.name, bytes] as const;
}));
const named = book.draws.find(row => 'file' in row);
if (named === undefined) throw new Error('Missing frozen named shape');
export const SHAPES = fixedDraws({slug: 'ci21-shapes', file: name => {
  const bytes = SHAPE_BYTES.get(name);
  if (bytes === undefined) throw new Error(`Missing frozen shape: ${name}`);
  return Promise.resolve(bytes);
}}, [{...named, slot: 'fixture.shape'}]);
await SHAPES.load();
export const GRASS_ROWS: GrassPresentationRows = parse(GrassPresentationSchema, grass.rows);
export const GRASS_FILES = new Map(Object.entries(grass.files).map(([name, pin]) => {
  if (!/^[a-f0-9]{64}\.bin$/u.test(pin.file)) throw new Error('Invalid frozen grass file');
  const bytes = new Uint8Array(readFileSync(resolve('test/fixtures/frozen/grass', pin.file)));
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Frozen grass block differs: ${name}`);
  return [name, bytes] as const;
}));
