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
 await adoptCookedManifest(url, row.key, row.dir, 'music');
}
/** SF11: a zone's own sfx set (`/assets/<slug>/sfx/<set>/sfx.json`, its cue bank and credit) joins the sfx tables the same
 *  way: no pin copies it under public/ any more, so the build's tables list only engine-wide sets (QA: the open plots'
 *  "Scene cue bank requires its credit" at level.play). The zone's parts copy wins over a baked one, as its score's does, so
 *  a head nightly-heads swaps to its cold cook plays that cook's set; a zone with no such mount adds nothing. */
export async function adoptCookedSfx(slug: string, set: string): Promise<void> {
 const url = `/assets/${slug}/sfx/${set}/sfx.json`, row = audioManifestRow(url);
 if (row?.kind !== 'sfx' || row.key !== set || row.dir === undefined) return;
 await adoptCookedManifest(url, row.key, row.dir, 'sfx');
}
async function adoptCookedManifest(url: string, key: string, dir: string, kind: 'music' | 'sfx'): Promise<void> {
 if (await spawnMountSize(url) === undefined) return;
 let bytes = await spawnHeldBytes(url);
 if (bytes === null) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing cooked ${kind} manifest: ${url}`);
  bytes = await response.arrayBuffer();
 }
 const raw: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
 if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || (kind === 'music' && parseManifest(raw) === undefined)) throw new Error(`Invalid cooked ${kind} manifest: ${url}`);
 const sizes: Record<string, number> = {};
 await Promise.all(manifestFiles(raw).map(async file => {
  const path = `${dir}${file}`, size = await spawnMountSize(path);
  if (size !== undefined) sizes[path] = size;
 }));
 const entry = {...Object.fromEntries(Object.entries(raw).filter(([field]) => field !== 'provenance' && field !== 'synth_keeps')), [ZONE_DIR]: dir};
 installAssetTables({ bytes: {...publicBytes(), ...sizes}, versions: assetVersions(),
  music: kind === 'music' ? {...musicManifests(), [key]: entry} : musicManifests(), sfx: kind === 'sfx' ? {...sfxManifests(), [key]: entry} : sfxManifests(), packs: bootPacks() });
}

/** Boot borrows admitted audio rows; the profile retains no product lease or decoded-asset copy. */
export async function folderAudioCatalogue(slug:string,product?:ShardFolder):Promise<LevelAudioProfile>{
 if(product!==undefined){
  const data = product.section('audio/audio').audio, music = data.music;
  if (music?.catalogue?.mode === 'bank' && music.source !== null && music.source !== undefined) await adoptCookedMusic(slug, music.source);
  if (data.samples?.set !== undefined) await adoptCookedSfx(slug, data.samples.set);
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
