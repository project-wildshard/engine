import {afterEach,expect,test,vi} from 'vitest';
import {openPglite} from './fixtures/pgliteDatabase';
import {roomBench} from './fixtures/dedicated/roomBench';
import {RoomBot} from './fixtures/dedicated/roomBot';
import {nativeObserverClient} from './fixtures/dedicated/nativeObserverClient';
import {playerSavesOver} from '../src/server/host/dedicated/playerSaves';
import {migrate} from '../src/server/host/dedicated/saves/migrate';

const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of closers.splice(0).reverse())await close();});

test('selected-worker durable redial preserves actual peer worker native frames',{timeout:120000},async()=>{
 const db=await openPglite();closers.push(db.close);await migrate(db);
 const saves=playerSavesOver(db,0,()=>{}),server=await roomBench({cells:['driftwood-isle','nalati-grasslands'],workers:2,saves});
 closers.push(server.close);
 const a=new RoomBot(server.url,'bench','device:worker-a','worker-a'),b=new RoomBot(server.url,'bench','device:worker-b','worker-b',0,0,{cell:'nalati-grasslands',spawn:false});
 for(const bot of [a,b])closers.push(()=>{bot.drop();return Promise.resolve();});
 expect(await a.arrived()).toBe(true);expect(await b.arrived()).toBe(true);
 const table=server.world.health().table,target=table['driftwood-isle'],peer=table['nalati-grasslands'];
 if(target===undefined||peer===undefined)throw Error('Missing worker table');expect(target).not.toBe(peer);
 const room=server.room('driftwood-isle'),body=room?.bodyOf('device:worker-a');if(!room||!body)throw Error('Missing worker body');
 room.cell.owned.of(body.id).file({grant:'coins',name:'coins',amount:31});
 const tick=b.client.latest?.tick??0,peerBoots=server.lines.filter(line=>line['at']==='worker.booted'&&line['index']===peer).length;
 expect(await server.world.restartDrainedWorker(target)).toBeUndefined();
 expect(await a.ended()).toBe('restart');expect(b.closed).toBeNull();
 await vi.waitFor(()=>{expect(b.client.latest?.tick).toBeGreaterThan(tick);});
 const native=await nativeObserverClient();closers.push(async()=>{await native.dispose?.();});
 const back=native.connect(server.url,'device:worker-a','worker-a');closers.push(()=>{back.close();return Promise.resolve();});
 await vi.waitFor(()=>{expect(back.read().tick).not.toBeNull();expect(back.read().checkpoint).not.toBeNull();expect(back.read().coins).toBe(31);});
 expect(back.read().checkpoint?.seq).toBeGreaterThan(0);
 expect(server.lines.filter(line=>line['at']==='worker.booted'&&line['index']===peer)).toHaveLength(peerBoots);
 expect(b.closed).toBeNull();expect(server.crashes).toEqual([]);
});
