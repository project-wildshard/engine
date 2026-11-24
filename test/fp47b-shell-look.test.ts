// FORMAT-PRUNE FP47b: the grid page shell and a neighbour cell's backdrop read their product's own level look
// (`look/look`'s `level`, `declaredLevel`) before the discovery document's, so discovery can drop sky, atmosphere, grade
// and horizon. Today's builds copy `look.level` into discovery byte for byte, so on every pinned product the shell's
// look hashes the same either way (no pixel can change); `pnpm pins` installs them under out/.
// oxlint-disable-next-line import/no-nodejs-modules -- The pinned products are read from disk.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The pinned products are read from disk.
import {existsSync,readdirSync,readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The pinned products are read from disk.
import {join,resolve} from 'node:path';
import {describe,expect,test} from 'vitest';
import {gridPageShell,gridPageShellLevel} from '../src/client/game/grid/pageShell';
import type {ShardManifest} from '../src/client/game/shard/manifest';
import type {LevelLookSource} from '../src/client/game/shardfile/declaredLook';

const OUT=resolve('out');
const json=(path:string):Record<string,unknown>=>JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>;
/** A pinned product's discovery manifest and its look source (`look/look`, and `ui/level` when it has one). */
function pinned(slug:string):{manifest:ShardManifest;product:LevelLookSource}{
 const root=join(OUT,slug),data=json(join(root,'mounts/shardfiles',slug,'discovery.json'))['data'];
 const look=json(join(root,'sections/look/look.json'))['look'] as LevelLookSource['look'];
 const level=join(root,'sections/ui/level.json');
 const manifest=existsSync(level)?json(level)['manifest'] as LevelLookSource['manifest']:undefined;
 return {manifest:data as ShardManifest,product:{look,...(manifest===undefined?{}:{manifest})}};
}
/** JSON with its keys sorted: the same values hash the same whichever object built them. */
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical)
 :typeof value==='object'&&value!==null?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(Reflect.get(value,key))])):value;
/** The look a shell draws, as one hash: sky, atmosphere, grade and horizon. */
function lookHash(manifest:Pick<ShardManifest,'sky'|'atmosphere'|'grade'|'horizon'>):string{
 const {sky,atmosphere,grade,horizon}=manifest;
 return createHash('sha256').update(JSON.stringify(canonical({sky,atmosphere,grade,horizon}))).digest('hex');
}
const slugs=existsSync(OUT)?readdirSync(OUT).filter(slug=>existsSync(join(OUT,slug,'mounts/shardfiles',slug,'discovery.json'))):[];

describe('FP47b: the grid shell reads its product\'s look first',()=>{
 test.skipIf(slugs.length===0).each(slugs)('pinned %s: the shell\'s look hashes the same from its product as from discovery',slug=>{
  const {manifest,product}=pinned(slug);
  expect(lookHash(gridPageShell(manifest,product))).toBe(lookHash(gridPageShell(manifest)));
  // the shell's level (`selectGridPageShell`), and the session's, which hands the product over too
  const shell=gridPageShell(manifest);
  expect(lookHash(gridPageShellLevel(gridPageShell(manifest,product)) as never)).toBe(lookHash(gridPageShellLevel(shell) as never));
  // the session boots its level from the whole manifest (`session.ts`), the shell's ground in place of a home's
  const whole={...manifest,ground:shell.ground};
  expect(lookHash(gridPageShellLevel(whole,product) as never)).toBe(lookHash(gridPageShellLevel(whole) as never));
 });

 test('a product\'s look.level wins over its discovery copy; with none, the discovery look stands',()=>{
  const sky={sunColor:[1,1,1],sunIntensity:1,envIntensity:0.5,bgIntensity:1,fogSunColor:[1,1,1],cloudSunColor:[1,1,1],hemiSky:1,hemiGround:2,hemiIntensity:0.7};
  const atmosphere={fogHeight:-20,fogHeightFalloff:0,fogHeightDensity:0,fogDistDensity:0,volumetricSunColor:[1,1,1]};
  const grade={saturation:0,brightness:0,contrast:0,bloomIntensity:0,bloomThreshold:1,shadowTint:[1,1,1],highTint:[1,1,1],lift:[0,0,0],gain:[1,1,1],gamma:1};
  const manifest={slug:'fixture',sky,atmosphere,grade,spawn:{x:0,z:0,yaw:0}} as unknown as ShardManifest;
  const level={sky:{...sky,sunIntensity:3},atmosphere,grade:{...grade,contrast:0.2}};
  const own=gridPageShell(manifest,{look:{level} as never});
  expect(own.sky.sunIntensity).toBe(3);
  expect(own.grade.contrast).toBe(0.2);
  expect(lookHash(gridPageShell(manifest,{look:{}}))).toBe(lookHash(gridPageShell(manifest)));
 });
});
