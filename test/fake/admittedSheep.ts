import { frozenNalatiJson, frozenNalatiBytes } from '../fixtures/frozen/nalati';
import { array, tuple, number, string, object, looseObject, parse, unknown } from 'valibot';
import { SpeciesActorsFileSchema, type SpeciesActorsFileRows } from '@wildshard/format/speciesActorsFile';
import { registeredJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { sha256 } from '../../src/shared/game/plugin/moduleHash';
import { fixtureFolderFile } from '../fixtures/folderFile';
import { SceneBakedGeometrySchema } from '@wildshard/format/sceneDressing';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { createShardFolder, type ShardFolder } from '../../src/shared/game/shardfile/shardFolder';
import { fixedDraws } from '../../src/client/game/models/fixedDraws';
import type { CrowdBody } from '../../src/client/game/ambient/crowdDraw';
import { fixtureJsonCheck } from '../fixtures/folderFile';

const crowdView = frozenNalatiJson('nalati-crowd-view.json');
const bakedInput = parse(object({ row: unknown(), pivots: array(tuple([number(), number(), number()])), parts: array(string()), radius: number() }), frozenNalatiJson('nalati-sheep-body.json'));
const bakedBody = { ...bakedInput, row: parse(SceneBakedGeometrySchema, { ...parse(looseObject({}), bakedInput.row), expand: false }) };

const species=parse(object({presentation:unknown()}),
  frozenNalatiJson('nalati-species-view.json'));

type SheepMetadata = SpeciesActorsFileRows;
/** The real baked sheep channels, admitted through the same named-file grammar as play. */
export function admittedSheepFolder(body: { readonly parts?: readonly string[]; readonly radius?: number } = {}): ReturnType<typeof createShardFolder> & { readonly bytes: Uint8Array; readonly metadata: SheepMetadata } {
  const bytes = frozenNalatiBytes('nalati-sheep-body.bin'), { row, ...baked } = bakedBody;
  const metadata = parse(SpeciesActorsFileSchema,{ species: species.presentation, page: { world: { slug: 'nalati-grasslands', hull: 'sheep', bounds: [-250,250,-250,250], rows: [], view: crowdView, material: {rim:.8,bands:.85} }, specimen: { slug: 'nalati-grasslands', hull: 'sheep', bounds: [-250,250,-250,250], rows: [], view: crowdView, material: {rim:.8,bands:.85} } }, draws:[{slot:'actors/sheep.bin',file:'actors/sheep.bin',channels:[],baked:{...row,expand:false}}], ...baked, ...body });
  const encoded = new TextEncoder().encode(JSON.stringify(metadata));
  const json = { file: fixtureFolderFile('actors/sheep.json', {hash: sha256(encoded), url: 'https://example.test/sheep.json', jsonSchema: registeredJsonSchema('actors/sheep.json')}) };
  const binary = { file: {hash: sha256(bytes), url: 'https://example.test/sheep.bin'} };
  const identity = { slug: 'sheep-admission', name: 'Sheep admission', author: 'Wildshard', revision: 1, seed: 1 };
  const product = createShardFolder({ slug: identity.slug, revision: 1, jsonCheck: fixtureJsonCheck, shardfile: emptyShardfile(identity), sections: new Map(),
    files: new Map([['actors/sheep.json', { ...json.file, url: 'https://example.test/sheep.json' }], ['actors/sheep.bin', { ...binary.file, url: 'https://example.test/sheep.bin' }]]),
    read: (hash: string) => {
      if (hash === json.file.hash) return Promise.resolve(encoded);
      if (hash === binary.file.hash) return Promise.resolve(bytes);
      throw new Error('Unexpected sheep product file');
    } });
  return { ...product, bytes, metadata };
}

/** The real shared fixed-draw intake; the fixture applies only the original animation bound. */
export async function admittedSheepBody(product:Pick<ShardFolder,'file'|'json'|'slug'>=admittedSheepFolder()):Promise<CrowdBody> {
  const rows=await product.json<SpeciesActorsFileRows>('actors/sheep.json'),draws=fixedDraws(product,rows.draws);
  await draws.load();
  const geometry=draws.handle('actors/sheep.bin').take();
  if(geometry.boundingSphere===null)throw new Error('Missing admitted sheep bound');
  geometry.boundingSphere.radius=rows.radius;
  return {geometry,pivots:rows.pivots,parts:rows.parts};
}
