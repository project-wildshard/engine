// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the admitted product and shipped physics bytes.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Native behavior assertions run in this bounded child.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {builtProduct} from '../builtProduct';
import {loadHeadlessProduct} from '../../../src/server/host/headlessProduct';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {NET_BUTTONS} from '../../../src/shared/engine/input/netButtons';
import {serializeSimSnapshot,snapshotSimHostBytes} from '../../../src/shared/engine/sim/snapshot';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {nativeTamingControls,nativeTamingOf} from '../../../src/server/game/riding/nativeTaming';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-verbs';

// J108, on the real Nalati stallion: a bot offers beside it, is put to the break (the approach is the first player's own
// tested law, and a chase is only a matter of ticks) and rides out every bucking round on its own session, and the horse leaves the wild for the bot's own mount. The first player cannot ride it, and later the wild has
// a stallion again for anyone else.
const directory=builtProduct('nalati-grasslands'),product=await loadHeadlessProduct(directory),shard=product.shardfile;
const descriptor=outputDescriptor(shard);assert.ok(descriptor);
const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,
  Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const resident=await createNativeProofResident({shard,assets,rapier,product},prepareHeadlessRuntime);
try{
  const {host}=resident,first=mountedPlayerOf(host),firstTaming=nativeTamingOf(host),controls=nativeTamingControls(host);
  assert.ok(first);assert.ok(firstTaming);assert.ok(controls);
  const stallion=[...host.entities.values()].find(actor=>actor.kind==='horse'&&actor.variant==='stallion');assert.ok(stallion);
  const bot=host.addPlayer('bot.tamer',{x:stallion.position.x-3,y:stallion.position.y+.3,z:stallion.position.z});
  let seq=0,balance=0,speed=0,sampled=0,breakingTicks=0,rounds=0,wasBreaking=false;
  for(let tick=0;tick<40_000;tick++){
    const session=controls.sessionOf(bot.id);
    if(session?.phase==='bonded')break;
    const breaking=session?.phase==='breaking';
    let x=0,z=0,sneak=true;
    if(!breaking){const dx=stallion.position.x-bot.position.x,dz=stallion.position.z-bot.position.z,length=Math.hypot(dx,dz);if(length>2.2){x=dx/length;z=dz/length;}sneak=length<8;} // the first player's own approach: upright at the page's 4.3 m/s, and the crouch for the last steps
    const gauge=session?.view.balance??0;
    if(!breaking){balance=gauge;speed=0;sampled=host.state.tick;}
    else{breakingTicks++;rounds=Math.max(rounds,session?.view.round??0);if(gauge!==balance){speed=(gauge-balance)/((host.state.tick-sampled)/60);balance=gauge;sampled=host.state.tick;}}
    controls.press(bot.id,{offer:true,lean:Math.max(-1,Math.min(1,balance*2+speed*1.1)),...((session?.interactable.radius??0)>0?{mount:true}:{})});
    if(session!==undefined&&!breaking&&(tick===30||wasBreaking))session.forceBreak(); // FAST-SLOW-TESTS FS3: a throw puts the bot straight back on, as the first break did
    wasBreaking=breaking;
    resident.lend([]);
    host.step(new Map([[bot.id,{seq:seq++&0xffff,viewTick:0,steer:{keyX:x,keyY:-z,stickX:0,stickY:0},yaw:0,pitch:0,buttons:sneak?NET_BUTTONS.crouch:0}]]));
  }
  const session=controls.sessionOf(bot.id),seat=mountedPlayerOf(host,bot.id);assert.ok(session);assert.ok(seat);
  assert.equal(session.phase,'bonded',`the bot earns the bond (round ${String(rounds)}, ${String(breakingTicks)} ticks breaking, ${String(bot.position.distanceTo(stallion.position))} m away)`);
  assert.equal(rounds,5);assert.equal(firstTaming.phase,'wild','the first player has tamed nothing');
  const mount=session.companion;assert.ok(mount);assert.equal(mount.variant,'tulpar');
  assert.equal(seat.horse,mount,'the bot rides off on its own mount');assert.equal(host.entities.get(mount.entityId),mount,'everyone sees it');
  assert.equal(stallion.position.y,-1e4,'the stallion has left the wild');
  seat.dismount();assert.equal(first.canRide(mount.entityId),false,'that horse is not the first player\'s');assert.equal(seat.canRide(mount.entityId),true);
  resident.lend([]);host.step();
  const refillId=[...host.adapters.keys()].find(id=>id.endsWith('.refill'));assert.ok(refillId,'a room waits for a new wild one');
  const adapter=host.adapters.get(refillId);assert.ok(adapter);
  const Owed=v.looseObject({clock:v.number(),pending:v.array(v.looseObject({from:v.string(),wait:v.number(),x:v.number(),z:v.number()}))});
  const owed=v.parse(Owed,adapter.snapshot()),entry=owed.pending[0];
  assert.deepEqual(owed.pending.map(row=>row.from),[stallion.entityId],'the room owes that horse');assert.ok(entry!==undefined&&entry.wait>60);
  const stand=(metres:number):void=>{for(const player of host.players.values()){player.position.set(entry.x+metres,player.position.y,entry.z);player.motor.resetAt(player.position);}};
  const seconds=(count:number):void=>{for(let tick=0;tick<count*60;tick++){resident.lend([]);host.step();}};
  // Two players near the spot run the clock twice as fast, and no player watches the horse appear.
  stand(10);seconds(1);
  const before=v.parse(Owed,adapter.snapshot()).pending[0]?.wait??0;seconds(4);
  assert.ok(Math.abs(before-(v.parse(Owed,adapter.snapshot()).pending[0]?.wait??0)-8)<2.1,'the wait runs at both players\' rate');
  // The room's debt survives a real save, and a save from the retired `wild` timer still loads.
  const resumed=await createNativeProofResident({shard,assets,rapier,product},prepareHeadlessRuntime,serializeSimSnapshot(snapshotSimHostBytes(host)));
  try{
    assert.deepEqual(v.parse(Owed,resumed.host.adapters.get(refillId)?.snapshot()).pending,v.parse(Owed,adapter.snapshot()).pending);
    const taming=resumed.host.adapters.get('nalati.taming');assert.ok(taming);
    const row=taming.snapshot();assert.ok(typeof row==='object'&&row!==null&&!Array.isArray(row));
    taming.restore({...row,wild:{[stallion.entityId]:0}});
  }finally{resumed.dispose();}
  const saved=v.parse(Owed,adapter.snapshot());
  adapter.restore({...saved,pending:saved.pending.map(row=>({...row,wait:0}))});
  seconds(2);assert.equal(stallion.position.y,-1e4,'it does not appear in front of a player');
  stand(150);seconds(2);
  assert.ok(stallion.position.y>-1e3,'a wild stallion stands again');assert.equal(stallion.alive,true);
  assert.equal(firstTaming.phase,'wild');assert.equal(first.canRide(mount.entityId),false,'the tamed horse stays the bot\'s');
  console.info(JSON.stringify({story:'bot-taming',ticks:host.state.tick,breakingTicks,rounds,mount:mount.entityId}));
}finally{resident.dispose();}
