// oxlint-disable-next-line import/no-nodejs-modules -- Read the catalogue's original declared public files.
import {readFileSync} from 'node:fs';
import {installPickupCatalogue,preparePickupCatalogue} from '../../src/client/game/models/specimenCatalogue';
import rows from '../../src/client/game/data/pickupCatalogue.json' with {type:'json'};

/** UI/loot tests need the authored coin recipe, without species or a world. */
export async function installPickupFixture():Promise<void>{
  const files=await preparePickupCatalogue({file:name=>Promise.resolve(new Uint8Array(readFileSync(`public${name}`)))},rows);
  installPickupCatalogue(rows,files);
}
