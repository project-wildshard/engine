import {afterAll,afterEach,beforeAll,expect,test,vi} from 'vitest';
import {playerSavesOver} from '../src/server/host/dedicated/playerSaves';
import {migrate} from '../src/server/host/dedicated/saves/migrate';
import {checkpointCertificate,checkpointWord} from '../src/server/host/dedicated/checkpointWitness';
import {roomBench,type RoomBench} from './fixtures/dedicated/roomBench';
import {RoomBot} from './fixtures/dedicated/roomBot';
import {openPglite} from './fixtures/pgliteDatabase';
import {nativeObserverClient} from './fixtures/dedicated/nativeObserverClient';
import type {PreparedObserver} from './fixtures/dedicated/releaseObserver';

const shard='driftwood-isle',device='device:witness',closers:(()=>Promise<void>)[]=[];
let native:PreparedObserver;
beforeAll(async()=>{native=await nativeObserverClient();});
afterAll(async()=>{await native?.dispose?.();});
afterEach(async()=>{for(const close of closers.splice(0).reverse())await close();});
async function fixture(){
 const db=await openPglite();closers.push(db.close);await migrate(db);
 const saves=playerSavesOver(db,0,()=>{});
 const bench=async():Promise<RoomBench>=>{const server=await roomBench({saves});closers.push(server.close);return server;};
 const first=await bench(),bot=new RoomBot(first.url,'bench',device,'witness-seed');
 closers.push(()=>{bot.drop();return Promise.resolve();});expect(await bot.arrived()).toBe(true);
 const room=first.room(shard),body=room?.bodyOf(device);if(!room||!body)throw Error('No seed body');
 room.cell.owned.of(body.id).file({grant:'coins',name:'coins',amount:17});
 expect(await first.world.drain()).toBe(true);
 const saved=await saves.readWitness?.(device,shard);expect(saved?.checkpoint).toBeDefined();
 return {db,saves,bench,saved};
}
function join(server:RoomBench){
 const bot=native.connect(server.url,device,'witness-back');closers.push(()=>{bot.close();return Promise.resolve();});return bot;
}

test('only an actual persisted document and successful native import emit a private checkpoint',{timeout:60000},async()=>{
 const f=await fixture(),server=await f.bench(),bot=join(server);
 await vi.waitFor(()=>{expect(bot.read().tick).not.toBeNull();expect(bot.read().checkpoint).toBeDefined();expect(bot.read().checkpoint).not.toBeNull();});
 const witness=bot.read().checkpoint;
 expect(witness).toEqual(f.saved?.checkpoint?.witness);expect(bot.read().coins).toBe(17);
 if(!witness)throw Error('No restored witness');
 const word=checkpointWord({cells:1,shards:[shard]},witness);
 expect(word).toBeDefined();const parsed=JSON.parse(new TextDecoder().decode(word));
 expect(parsed.device).toBeUndefined();expect(parsed.cells).toBe(1);expect(parsed.shards).toEqual([shard]);
 expect(new TextEncoder().encode(JSON.stringify(parsed.status)).byteLength).toBeLessThanOrEqual(512);
 const other=native.connect(server.url,'device:witness-other','witness-other');closers.push(()=>{other.close();return Promise.resolve();});
 await vi.waitFor(()=>{expect(other.read().tick).not.toBeNull();});expect(other.read().checkpoint).toBeNull();
});
test('a held-body rejoin never reuses an earlier database certificate',{timeout:60000},async()=>{
 const f=await fixture(),server=await f.bench(),first=join(server);
 await vi.waitFor(()=>{expect(first.read().checkpoint).not.toBeNull();});first.close();
 await vi.waitFor(()=>{expect(server.room(shard)?.holds(device)).toBe(true);});
 const held=join(server);await vi.waitFor(()=>{expect(held.read().tick).not.toBeNull();});
 expect(held.read().checkpoint).toBeNull();expect(held.read().coins).toBe(17);
});
test('a current document that cannot import cannot certify fallback progress',{timeout:60000},async()=>{
 const f=await fixture(),doc=f.saved?.doc;if(!doc)throw Error('Missing seed');
 f.saves.write({player:device,name:'witness',build:'bench',receipts:[],shard,seq:2,reason:'checkpoint',doc:{...doc,at:{...doc.at,x:99999}},saveVersion:1});
 expect(await f.saves.drain(3000)).toBe(true);
 const second=await f.bench(),bot=join(second);await vi.waitFor(()=>{expect(bot.read().tick).not.toBeNull();});
 expect(bot.read().checkpoint).toBeNull();expect(bot.read().coins).toBe(17);
});
test('a parser recovery from the previous durable copy remains unknown',{timeout:60000},async()=>{
 const f=await fixture(),doc=f.saved?.doc;if(!doc)throw Error('Missing seed');
 f.saves.write({player:device,name:'witness',build:'bench',receipts:[],shard,seq:2,reason:'checkpoint',doc,saveVersion:1});expect(await f.saves.drain(3000)).toBe(true);
 await f.db.query('update player_save set doc = $1 where player_id = $2',[JSON.stringify({broken:true}),device]);
 const recovered=await f.saves.readWitness?.(device,shard);expect(recovered?.checkpoint).toBeUndefined();
});
test('checkpoint admission refuses absent sequence provenance and oversized status',{timeout:60000},async()=>{
 const f=await fixture(),doc=f.saved?.doc;if(!doc)throw Error('Missing seed');
 expect(checkpointCertificate(doc,0,shard)).toBeUndefined();expect(checkpointCertificate(doc,1,'x'.repeat(97))).toBeUndefined();
 const witness=f.saved?.checkpoint?.witness;if(!witness)throw Error('No witness');
 expect(checkpointWord({cells:1,shards:[shard]},{...witness,progressHash:'x'.repeat(600)})).toBeUndefined();
});
