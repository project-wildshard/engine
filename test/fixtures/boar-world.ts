import { installKitWorldFixture } from './kit-world';
import { registerSpecies } from '../../src/shared/engine/entities/species/registry';
import { speciesWithLook } from '../../src/client/engine/entities/species/look';
import { HullLookBook } from '../../src/client/game/looks/speciesBook';
import { numericCreaturePose } from '../../src/shared/game/plugin/channelPrograms';
import {parse,object,unknown} from 'valibot';
import {SpeciesSchema} from '@wildshard/format/speciesPrograms';
import {frozenRuntimeJson} from './frozen/snapshots';
const {boar:PINE_BOAR,elk:PINE_ELK,looks:SPECIES_LOOKS,clips:THRALL_CLIPS}=parse(object({boar:SpeciesSchema,elk:SpeciesSchema,looks:unknown(),clips:unknown()}),frozenRuntimeJson('pine-creature-world.json'));

/** Boar manager fixtures retain the full world's exact final Pine boar row,
 * body and pose over the shared baseline, plus its real selected level and
 * assets. Other species, scalar banks, places and quests are unused here. */
export async function installBoarWorldFixture(): Promise<void> {
  await installKitWorldFixture();
  const pineBook = new HullLookBook(SPECIES_LOOKS);
  registerSpecies(speciesWithLook(PINE_BOAR, { ...pineBook.look('boar'), postPose: numericCreaturePose(THRALL_CLIPS) }));
}

/** Original Pine elk registration for the model lifetime lookup. Shared owners are installed by the caller. */
export function installFrozenElkFixture():void {
 const book=new HullLookBook(SPECIES_LOOKS);registerSpecies(speciesWithLook(PINE_ELK,book.look('elk')));
}
