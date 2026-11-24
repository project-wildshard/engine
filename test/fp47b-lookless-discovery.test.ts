// FORMAT-PRUNE FP47b, last half: the SDK stops copying the level look (sky, atmosphere, grade, horizon) into the
// discovery document, and lifts a product's look into `look/look`'s `level` when it has no `ui/level` (the open plots,
// Mirror Salt, Mossgate). Before admission engine reads such a lookless discovery (`shardFromDiscovery`, its
// `defineAuthoredShard` gives the plain look); every reader that draws the level reads the product's `look.level` first
// (`declaredLevel`: the grid shell, a neighbour's backdrop, an admitted declared page). On every pinned product: the
// lookless discovery admits, and the look each draws hashes the same as today's.
// oxlint-disable-next-line import/no-nodejs-modules -- The pinned products are read from disk.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The pinned products are read from disk.
import {existsSync,readdirSync,readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The pinned products are read from disk.
import {join,resolve} from 'node:path';
import {levelLook,type LookLevel} from '@wildshard/format/look-level';
import {describe,expect,test} from 'vitest';
import {gridPageShell,gridPageShellLevel,selectGridPageShell} from '../src/client/game/grid/pageShell';
import {gridLookSource} from '../src/client/game/grid/folders';
import {configureLevel,selectedLevel} from '@wildshard/engine/level/selection';
import {shardFromDiscovery} from '../src/client/game/shard/discovery';
import {PLAIN_LEVEL_LOOK} from '../src/client/game/shard/manifest';
import {declaredLevel,type LevelLookSource} from '../src/client/game/shardfile/declaredLook';

const OUT=resolve('out'),WORDS=['sky','atmosphere','grade','horizon'] as const;
const json=(path:string):Record<string,unknown>=>JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>;
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical)
 :typeof value==='object'&&value!==null?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(Reflect.get(value,key))])):value;
const lookHash=(look:object):string=>createHash('sha256')
 .update(JSON.stringify(canonical(Object.fromEntries(WORDS.map(word=>[word,Reflect.get(look,word)]))))).digest('hex');
const slugs=existsSync(OUT)?readdirSync(OUT).filter(slug=>existsSync(join(OUT,slug,'mounts/shardfiles',slug,'discovery.json'))):[];

/** A pinned product as today's SDK writes it, and as the next one does: the look in `look.level` only. */
function pinned(slug:string):{document:Record<string,unknown>;lookless:Record<string,unknown>;today:LevelLookSource;next:LevelLookSource}{
 const root=join(OUT,slug),document=json(join(root,'mounts/shardfiles',slug,'discovery.json'));
 const data=document['data'] as Record<string,unknown>,look=json(join(root,'sections/look/look.json'))['look'] as LevelLookSource['look'];
 const levelPath=join(root,'sections/ui/level.json'),manifest=existsSync(levelPath)?json(levelPath)['manifest'] as LevelLookSource['manifest']:undefined;
 const today:LevelLookSource={look,...(manifest===undefined?{}:{manifest})};
 // the next SDK: a look with no level takes the discovery's (sharddev `liftDiscoveryStart`), the manifest's at the door
 const lifted=levelLook(today as Parameters<typeof levelLook>[0])??levelLook({look:{},manifest:data as LevelLookSource['manifest']&object});
 const next:LevelLookSource={look:lifted===undefined?look:{...look,level:lifted as LookLevel}};
 const lookless={...document,data:Object.fromEntries(Object.entries(data).filter(([word])=>!(WORDS as readonly string[]).includes(word)))};
 return {document,lookless,today,next};
}

describe('FP47b: a discovery with no level look',()=>{
 test.skipIf(slugs.length===0).each(slugs)('pinned %s: admits, and every reader draws the same look from its product',slug=>{
  const {document,lookless,today,next}=pinned(slug);
  const now=shardFromDiscovery(document),then=shardFromDiscovery(lookless);
  // before admission the lookless discovery reads the plain look (defineAuthoredShard)
  expect(lookHash(then as never)).toBe(lookHash({...PLAIN_LEVEL_LOOK} as never));
  const drawn=lookHash(declaredLevel(now,today) as never);
  expect(lookHash(declaredLevel(then,next) as never)).toBe(drawn);
  expect(lookHash(gridPageShell(then,next))).toBe(lookHash(gridPageShell(now,today)));
  const shell=gridPageShell(now);
  expect(lookHash(gridPageShellLevel({...then,ground:shell.ground},next) as never)).toBe(lookHash(gridPageShellLevel({...now,ground:shell.ground},today) as never));
 });
 test.skipIf(slugs.length===0).each(slugs)('pinned %s: the session reads the shell\'s look from its product\'s look/look',slug=>{
  const {lookless,today,next}=pinned(slug),then=shardFromDiscovery(lookless);
  const read=gridLookSource(json(join(OUT,slug,'sections/look/look.json')));
  // an older product (no look.level) reads none, and its discovery keeps the look; the next SDK's always has one
  if(read===null){expect(next.look.level===undefined||today.look.level===undefined).toBe(true);return;}
  expect(lookHash(gridPageShell(then,read))).toBe(lookHash(gridPageShell(then,next)));
 });
 test('a look/look with no level, or none at all, reads no look source',()=>{
  expect(gridLookSource(null)).toBeNull();
  expect(gridLookSource({look:{keys:[]}})).toBeNull();
 });
 test.skipIf(slugs.length===0)('the selected shell level re-reads its look from the loaded product, and restores the page level',()=>{
  const slug=slugs[0] as string,{document,lookless,today,next}=pinned(slug);
  const now=shardFromDiscovery(document),then=shardFromDiscovery(lookless),page=gridPageShellLevel(gridPageShell(now,today));
  configureLevel(page);
  const selection=selectGridPageShell(then);
  const plain=lookHash(gridPageShellLevel(gridPageShell(then)) as never);
  expect(plain).not.toBe(lookHash(page as never));
  expect(lookHash(selectedLevel() as never)).toBe(plain);
  expect(selection.look(undefined)).toBe(selection.shell);
  expect(lookHash(selectedLevel() as never)).toBe(plain);
  // the page manifest the session boots from, and the selected level, take the product's look
  expect(lookHash(selection.look(next))).toBe(lookHash(gridPageShell(now,today)));
  expect(lookHash(selection.shell)).toBe(lookHash(gridPageShell(now,today)));
  expect(lookHash(selectedLevel() as never)).toBe(lookHash(page as never));
  selection.dispose();
  expect(selectedLevel()).toBe(page);
 });
});
