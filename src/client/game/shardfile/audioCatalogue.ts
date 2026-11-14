import {Scope} from '@wildshard/engine/app/scope';
import {createCatalogueAudio,type LevelAudioProfile} from '@wildshard/engine/audio/levelAudio';
import {loadFirstPartyFolder} from './runtimeFolder';
import type {ShardFolder} from '../../../shared/game/shardfile/shardFolder';

/** Boot borrows admitted audio rows; the profile retains no product lease or decoded-asset copy. */
export async function folderAudioCatalogue(slug:string,product?:ShardFolder):Promise<LevelAudioProfile>{
 if(product!==undefined)return createCatalogueAudio(product.section('audio/audio').audio);
 const scope=new Scope(`audio.catalogue:${slug}`);
 try{return await folderAudioCatalogue(slug,await loadFirstPartyFolder(slug,scope));}
 finally{scope.dispose();}
}
/** Full catalogue inventory preserves the music-then-SFX ordering used by counted boot. */
export async function folderAudioFiles(slug:string):Promise<readonly string[]>{
 const files=(await folderAudioCatalogue(slug)).files();return [...files.music,...files.sfx];
}
