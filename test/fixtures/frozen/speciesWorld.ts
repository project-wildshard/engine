import {vi} from 'vitest';
import {parse,object,unknown} from 'valibot';
import {SpeciesPresentationSchema} from '@wildshard/format/speciesBookRows';
import {HullLookBookSchema} from '@wildshard/format/speciesLooks';
import {productSpeciesCatalogue} from '../../../src/client/game/looks/speciesBook';
import {registerSpecies} from '../../../src/shared/engine/entities/species/registry';
import {speciesWithLook} from '../../../src/client/engine/entities/species/look';
import {installKitWorldFixture} from '../kit-world';
import {installFrozenElkFixture} from '../boar-world';
import {frozenNalatiJson} from './nalati';
import {frozenAsset} from './assets';
let installed:Promise<void>|undefined;
/** The original complete species envelope and packed bodies, without unrelated quests or author source. */
export function installFrozenSpeciesWorld():Promise<void>{return installed??=prepare();}
async function prepare():Promise<void>{
 await installKitWorldFixture();
 installFrozenElkFixture();
 const view=parse(object({hullBook:HullLookBookSchema,presentation:SpeciesPresentationSchema,looks:unknown()}),frozenNalatiJson('nalati-species-view.json'));
 const catalogue=productSpeciesCatalogue({section:()=>view.hullBook,file:async name=>{
  if(name!=='actors/balbal-cracks.bin')throw new Error(`Unexpected frozen species product file ${name}`);
  return frozenAsset('nalati-balbal-cracks.bin');
 }},view.presentation,view.looks);
 for(const row of catalogue.rows){const look=catalogue.looks.find(candidate=>candidate.kind===row.kind);if(look===undefined)throw new Error('Missing original species look');registerSpecies(speciesWithLook(row,look));}
 const file=view.presentation.packedBodies?.file;
 if(file===undefined)throw new Error('Missing original packed species file');
 const read=vi.spyOn(globalThis,'fetch').mockImplementation(input=>{
  if(input!==file)throw new Error(`Unexpected frozen species fetch ${String(input)}`);
  return Promise.resolve(new Response(frozenAsset('nalati-bodies.bin')));
 });
 try{await catalogue.preload();}finally{read.mockRestore();}
}
