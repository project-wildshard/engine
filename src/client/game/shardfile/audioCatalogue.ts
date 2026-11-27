import {Scope} from '@wildshard/engine/app/scope';
import {createCatalogueAudio,type LevelAudioProfile} from '@wildshard/engine/audio/levelAudio';
import {manifestFiles, parseManifest, type ScoreSet} from '@wildshard/engine/audio/bootAudio';
import {assetVersions, bootPacks, installAssetTables, musicManifests, publicBytes, sfxManifests} from '@wildshard/engine/boot/tables';
import {audioManifestRow, ZONE_DIR} from '@wildshard/engine/boot/zoneAssets';
import {loadCatalogueFolder} from './runtimeFolder';
import type {ShardFolder} from '../../../shared/game/shardfile/shardFolder';
import {spawnHeldBytes, spawnMountSize} from '../boot/spawnDownload';

/** The boot's verified parts supply the score and its byte counts on pages built without the zone. */
export async function adoptCookedMusic(slug: string, source: ScoreSet): Promise<void> {
 const url = `${source.dir}music.json`, row = audioManifestRow(url);
 if (row?.key !== source.manifestKey || row.dir !== source.dir || !source.dir.startsWith(`/assets/${slug}/music/`)) return;
 if (await spawnMountSize(url) === undefined) return;
 let bytes = await spawnHeldBytes(url);
 if (bytes === null) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing cooked music manifest: ${url}`);
  bytes = await response.arrayBuffer();
 }
 const raw: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
 if (parseManifest(raw) === undefined || raw === null || typeof raw !== 'object') throw new Error(`Invalid cooked music manifest: ${url}`);
 const sizes: Record<string, number> = {};
 await Promise.all(manifestFiles(raw).map(async file => {
  const path = `${source.dir}${file}`, size = await spawnMountSize(path);
  if (size !== undefined) sizes[path] = size;
 }));
 installAssetTables({ bytes: {...publicBytes(), ...sizes}, versions: assetVersions(),
  music: {...musicManifests(), [row.key]: {...raw, [ZONE_DIR]: row.dir}}, sfx: sfxManifests(), packs: bootPacks() });
}

/** Boot borrows admitted audio rows; the profile retains no product lease or decoded-asset copy. */
export async function folderAudioCatalogue(slug:string,product?:ShardFolder):Promise<LevelAudioProfile>{
 if(product!==undefined){
  const data = product.section('audio/audio').audio, music = data.music;
  if (music?.catalogue?.mode === 'bank' && music.source !== null && music.source !== undefined) await adoptCookedMusic(slug, music.source);
  return createCatalogueAudio(data);
 }
 const scope=new Scope(`audio.catalogue:${slug}`);
 try{return await folderAudioCatalogue(slug,await loadCatalogueFolder(slug,scope));}
 finally{scope.dispose();}
}
/** Full catalogue inventory preserves the music-then-SFX ordering used by counted boot. */
export async function folderAudioFiles(slug:string):Promise<readonly string[]>{
 const files=(await folderAudioCatalogue(slug)).files();return [...files.music,...files.sfx];
}
