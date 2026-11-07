import {Scope} from '@wildshard/engine/app/scope';
import {createCatalogueAudio,type LevelAudioProfile} from '@wildshard/engine/audio/levelAudio';
import {loadFirstPartyProduct} from './runtimeProduct';
import type {ShardProduct} from '../../../shared/game/shardfile/shardProduct';

/** Boot borrows admitted audio rows; the profile retains no product lease or decoded-asset copy. */
export async function productAudioCatalogue(slug:string,product?:ShardProduct):Promise<LevelAudioProfile>{
 if(product!==undefined)return createCatalogueAudio(product.section('audio/audio').audio);
 const scope=new Scope(`audio.catalogue:${slug}`);
 try{return await productAudioCatalogue(slug,await loadFirstPartyProduct(slug,scope));}
 finally{scope.dispose();}
}
/** Full catalogue inventory preserves the music-then-SFX ordering used by counted boot. */
export async function productAudioFiles(slug:string):Promise<readonly string[]>{
 const files=(await productAudioCatalogue(slug)).files();return [...files.music,...files.sfx];
}
