// ZONE-SNAPSHOTS ZS9 (J507): Nalati's live species catalogue (its actors presentation, packed looks and packed bodies),
// read from the live pin as the client's species.program does, without unrelated quests or author source.
import {parse,object} from 'valibot';
import {SpeciesPresentationSchema} from '@wildshard/format/speciesBookRows';
import {folderSpeciesCatalogue} from '../../src/client/game/looks/speciesBook';
import {registerSpecies} from '../../src/shared/engine/entities/species/registry';
import {speciesWithLook} from '../../src/client/engine/entities/species/look';
import {installKitWorldFixture} from './kit-world';
import {liveBytes,liveJson} from './livePin';
const NALATI='nalati-grasslands';
let installed:Promise<void>|undefined;
export function installLiveSpeciesWorld():Promise<void>{return installed??=prepare();}
async function prepare():Promise<void>{
 await installKitWorldFixture();
 const presentation=parse(object({species:SpeciesPresentationSchema}),liveJson(NALATI,'actors/sheep.json')).species;
 const catalogue=folderSpeciesCatalogue({section:()=>{throw new Error('Nalati declares no hull book');},has:()=>false,file:name=>Promise.resolve(liveBytes(NALATI,name))},
  presentation,liveJson(NALATI,'actors/species-looks.json'));
 for(const row of catalogue.rows){const look=catalogue.looks.find(candidate=>candidate.kind===row.kind);if(look===undefined)throw new Error('Missing live species look');registerSpecies(speciesWithLook(row,look));}
 await catalogue.preload();
}
