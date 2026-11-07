// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the admitted product and shipped physics bytes.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Native behavior assertions run in this bounded child.
import assert from 'node:assert/strict';
import type {NetCommand} from '@wildshard/format/netCommand';
import {builtProduct} from '../builtProduct';
import {loadHeadlessProduct} from '../../../src/server/host/headlessProduct';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {NET_BUTTONS} from '../../../src/shared/engine/input/netButtons';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-verbs';

// E3.6: in real Nalati a bot walks up to a camp horse, takes it on its own seat and gallops off on its own reins while the
// first player rides another. Nothing here touches the bot but a mount call and the same NetCommand a client sends.
const directory=builtProduct('nalati-grasslands'),product=await loadHeadlessProduct(directory),source=product.shardfile;
const descriptor=outputDescriptor(source);assert.ok(descriptor);
const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,
  Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const resident=await createNativeProofResident({shard:source,assets,rapier,product},prepareHeadlessRuntime);
try{
  const {host}=resident,first=mountedPlayerOf(host);assert.ok(first);
  const [mine,theirs]=first.mountables;assert.ok(mine);assert.ok(theirs);assert.notEqual(mine,theirs);
  const bot=host.addPlayer('bot.rider',{x:theirs.position.x+1.5,y:theirs.position.y+.2,z:theirs.position.z});
  resident.step([]);
  const seat=mountedPlayerOf(host,bot.id);assert.ok(seat);assert.notEqual(seat,first);
  assert.equal(seat.mount(theirs.entityId),true);assert.equal(bot.modes.current(),'ride');
  assert.equal(first.mount(theirs.entityId),false,'one horse, one rider');
  assert.equal(first.mount(mine.entityId),true);assert.equal(first.mounted,true);
  let seq=0;
  const net=(forward:number,turn:number,sprint:boolean):NetCommand=>({seq:seq++&0xffff,viewTick:0,steer:{keyX:0,keyY:forward,stickX:turn,stickY:0},yaw:bot.yaw,pitch:0,buttons:sprint?NET_BUTTONS.sprint:0});
  const tick=(forward:number,turn:number,sprint=false):void=>{resident.lend([]);host.step(new Map([[bot.id,net(forward,turn,sprint)]]));};
  for(let at=0;at<90;at++)tick(-1,0);
  assert.ok(seat.body.speed<0,'the reins back it away');
  for(let at=0;at<240;at++){
    const delta=Math.atan2(Math.sin(seat.body.heading+Math.PI/2),Math.cos(seat.body.heading+Math.PI/2));
    tick(0,Math.max(-1,Math.min(1,delta*2)));
  }
  const start=seat.body.feet.clone(),firstAt=first.body.feet.clone();
  for(let at=0;at<1200&&seat.body.gait!=='gallop';at++)tick(1,0,true);
  assert.equal(seat.body.gait,'gallop','held reins reach an actual gallop');
  for(let at=0;at<120;at++)tick(1,0,true);
  const ridden=seat.body.feet.distanceTo(start);
  assert.ok(ridden>10,`the horse really went: ${ridden}`);
  assert.ok(bot.position.distanceTo(seat.body.feet)<4,'the rider sits on it');
  assert.ok(Math.hypot(theirs.position.x-seat.body.feet.x,theirs.position.z-seat.body.feet.z)<1,'and the world sees the horse there');
  assert.ok(first.body.feet.distanceTo(firstAt)<.1,'the first player rests on their own horse');
  const saved=host.adapters.get('nalati.mounted')?.snapshot();
  assert.ok(typeof saved==='object'&&saved!==null&&'others' in saved,'the bot\'s seat saves with the world');
  const gait=seat.body.gait,horse=seat.horse;
  seat.dismount();assert.equal(seat.mounted,false);assert.equal(horse?.driven,false);assert.equal(bot.modes.current(),'foot');assert.equal(first.mounted,true);
  console.info(JSON.stringify({story:'bot-ride',gait,ridden,ticks:host.state.tick}));
}finally{resident.dispose();}
