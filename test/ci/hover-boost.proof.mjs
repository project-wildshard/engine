// oxlint-disable-next-line import/no-nodejs-modules -- CI-only native movement uses Node assertions.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Explicit cases remain outside hook and Vitest discovery.
import {test,after} from 'node:test';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the exact pinned native physics module, not generated output.
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {PerspectiveCamera} from 'three';
const page=new Window({url:'http://127.0.0.1/hover-proof'}),borrowed=new Map();
for(const key of ['window','document','location','localStorage','HTMLElement','Element','Node','Event','CustomEvent','PointerEvent','HTMLCanvasElement','ResizeObserver','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame']){
 borrowed.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
 const value=key==='window'?page:page[key];
 Object.defineProperty(globalThis,key,{configurable:true,value:typeof value==='function'&&/^[a-z]/u.test(key)?value.bind(page):value});
}
const {Scope}=await import('../../src/shared/engine/app/scope.ts');
const {withOwner}=await import('../../src/shared/engine/app/ownership.ts');
const {Physics}=await import('../../src/shared/engine/physics/Physics.ts');
const {groups}=await import('../../src/shared/engine/physics/groups.ts');
const {loadRapier}=await import('../../src/shared/engine/physics/rapier.ts');
const {Player}=await import('../../src/client/engine/player/Player.ts');
const {app}=await import('../../src/client/engine/app/runtime.ts');
const {setDev}=await import('../../src/client/engine/core/devMode.ts');
const {mountBoostLook,BOOST_TAP_MS}=await import('../../src/client/engine/ui/hoverBoost.ts');
const {installShardHoverSpeed,installGridHoverSpeed,gridHoverSpeed}=await import('../../src/shared/game/grid/rules.ts');
const {hoverSpeed}=await import('../../src/shared/engine/player/hoverSpeed.ts');
const {CHUNK_HALF,CONTENT_CAPS,ROAD_WIDTH}=await import('../../src/shared/engine/core/config.ts');
const {createSimHost}=await import('../../src/server/engine/sim.ts');
const {allowDeveloperBoost}=await import('../../src/server/engine/sim/playerSim.ts');
const {leadPlayer}=await import('../../src/shared/engine/sim/leadPlayer.ts');
const {NetClient}=await import('../../src/client/engine/net/client.ts');
const {NetRoom}=await import('../../src/server/engine/net/room.ts');
const {SimNetWorld}=await import('../../src/server/engine/net/simWorld.ts');
const {directLoopback}=await import('../../src/test/engine/netLoopback.ts');
const {SIM_LEVEL}=await import('../fixtures/sim-level/level.ts');
const {NET_BUTTONS}=await import('../../src/shared/engine/input/netButtons.ts');
const R=await loadRapier(Uint8Array.from(readFileSync(new URL(import.meta.resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')))));
const limit=9500,dt=1/60;
function check(name,work){void test(name,{timeout:limit},()=>{const start=performance.now();try{work();}finally{setDev(false);}assert.ok(performance.now()-start<limit,'Complete hover proof exceeds 9.5 seconds');});}
function fixture(){
 const listenersBefore=app.events.census().listeners;
 const scope=new Scope('hover-physical-proof'),physics=new Physics(R,undefined,scope);
 try{
  physics.world.createCollider(R.ColliderDesc.cuboid(10000,1,10000).setTranslation(0,-1,0).setCollisionGroups(groups('WORLD')));
  const player=withOwner(scope,()=>new Player(new PerspectiveCamera(),physics,document.createElement('canvas')));
  scope.onDispose(()=>player.motor.dispose());
  player.bindFrame(physics,player.motor,{heightAt:()=>0,waterSurfaceAt:()=>null,platforms:[]});
  player.spawn(0,0,0,0);player.setHover(true);player.keys.add('KeyW');
  const root=document.createElement('div');document.body.append(root);scope.onDispose(()=>root.remove());
  const button=document.createElement('button');button.className='ws-touch-hover';root.append(button);mountBoostLook(button,player,app.events,scope);
  return {scope,physics,player,root,button,listenersBefore,dispose(){try{scope.dispose();assert.equal(app.events.census().listeners,listenersBefore,'Hover fixture retained a real event subscription');}finally{physics.dispose();}}};
 }catch(error){try{scope.dispose();}finally{physics.dispose();}throw error;}
}
// QA row 42: no BOOST button; Developer boost is a double tap of the hover action (H / the HOVER tab), a clock apart from the last
let clock=0;
function tap(f){clock+=1000;f.player.tapHover(clock);f.player.tapHover(clock+BOOST_TAP_MS/2);app.events.flush('input');}
function single(f){clock+=1000;f.player.tapHover(clock);app.events.flush('input');}
const amber=f=>f.button.classList.contains('boost');
function speed(f,expected){
 let start;
 for(let tick=0;tick<720;tick++){f.player.input(dt);f.physics.step();f.player.stepDevice(dt);if(tick===599)start=f.player.position.clone();}
 assert.ok(start);const actual=f.player.position.distanceTo(start)/2;
 assert.ok(Math.abs(actual-expected)<0.00001,`Actual motor speed ${actual} differs from ${expected}`);
 assert.ok(Math.abs(f.player.position.x)<0.001);assert.ok(Math.abs(f.player.position.y-0.45)<0.01);
}
check('real standalone Player movement follows the HOVER double tap, its amber look and the retained latch',()=>{
 for(const road of [false,true]){
  const f=fixture();try{
   installShardHoverSpeed(f.player,f.scope,road?'road':'shard');
   setDev(false);tap(f);assert.equal(f.player.hover,true,'A Developer-off double tap is two plain taps: off and on again');assert.equal(f.player.hoverBoost,false);assert.equal(amber(f),false);speed(f,road?30:14);
   setDev(true);tap(f);assert.equal(f.player.hover,true);assert.equal(f.player.hoverBoost,true);assert.equal(amber(f),true);speed(f,road?60:56);
   setDev(false);assert.equal(amber(f),false);tap(f);assert.equal(f.player.hoverBoost,true);speed(f,road?30:14);
   setDev(true);tap(f);assert.equal(f.player.hoverBoost,false);assert.equal(amber(f),false);speed(f,road?30:14);
   tap(f);assert.equal(amber(f),true);single(f);assert.equal(f.player.hover,false,'A single tap still steps off at once');assert.equal(amber(f),false);
   single(f);assert.equal(f.player.hover,true);assert.equal(f.player.hoverBoost,true,'The latch outlives a dismount, as the BOOST button\'s did');assert.equal(amber(f),true);
   const retained=f.button;f.scope.dispose();assert.equal(retained.classList.contains('boost'),false);assert.equal(app.events.census().listeners,f.listenersBefore,'Retired hover retained a real player.hover / player.boost subscription');app.events.emit('player.boost',true);app.events.emit('player.hover',true);app.events.flush('input');assert.equal(retained.classList.contains('boost'),false,'Retired HOVER look still responds to live events');setDev(false);
  }finally{f.dispose();}
 }
});
check('real grid movement reads class and eased caps live and restores the previous owner',()=>{
 const f=fixture(),owner=f.scope.child('grid-policy'),previous=()=>12;
 let point={x:0,y:0,z:0},cap=14,speedClass='road';
 try{
  f.player.hoverSpeedLimit=previous;
  installGridHoverSpeed(f.player,owner,()=>({local:point,shardCap:cap,speedClass,onHighwayDeck:true}));
  setDev(false);speed(f,30);speedClass='shard';speed(f,14);
  setDev(true);tap(f);speed(f,56);
  cap=10;speed(f,40);cap=14;point={x:(CHUNK_HALF+(CONTENT_CAPS.pitch-ROAD_WIDTH)/2)/2,y:0,z:0};assert.equal(gridHoverSpeed(point,cap),22);speed(f,58);
  speedClass='road';speed(f,60);
  owner.dispose();assert.equal(f.player.hoverSpeedLimit,previous);speed(f,48);
  const replacement=()=>10,other=f.scope.child('superseded-policy');installGridHoverSpeed(f.player,other,()=>({local:point,shardCap:14,onHighwayDeck:true}));f.player.hoverSpeedLimit=replacement;other.dispose();assert.equal(f.player.hoverSpeedLimit,replacement);speed(f,40);
  assert.throws(()=>hoverSpeed(60,true),RangeError);assert.equal(hoverSpeed(),14);
 }finally{f.dispose();}
});
check('real sustained command bytes keep boost gated through the native server motor',()=>{
 const f=fixture(),host=createSimHost({...SIM_LEVEL,id:'hover-wire-proof',entities:[],quests:[],ground:{size:10000,height:0}},{rapier:R});
 const body=leadPlayer(host),world=new SimNetWorld(host),link=directLoopback(),client=new NetClient(link.client);
 const room=new NetRoom({world,step:inputs=>host.step(new Map(inputs.filter(input=>input.command!==null).map(input=>[input.player,input.command])))});
 const wireSpeed=expected=>{
  let start;
  for(let tick=0;tick<720;tick++){
   client.command({...f.player.sampleHeldCommand(),viewTick:0});client.flush();link.pump();room.tick();link.pump();if(tick===599)start=body.position.clone();
  }
  assert.ok(start);const actual=body.position.distanceTo(start)/2;assert.ok(Math.abs(actual-expected)<0.00001,`Actual wire motor speed ${actual} differs from ${expected}`);assert.equal(client.dropped,0);assert.equal(body.modes.current(),'board');
 };
 try{
  installShardHoverSpeed(body,host.scope,'road');
  room.join(link.server);client.hello();link.pump();room.open();link.pump();
  client.command({steer:{keyX:0,keyY:0,stickX:0,stickY:0},yaw:0,pitch:0,viewTick:0,buttons:NET_BUTTONS.hover});client.flush();link.pump();room.tick();link.pump();
  setDev(true);tap(f);f.player.input(dt);
  assert.ok((f.player.sampleCommand().buttons&NET_BUTTONS.boost)!==0);
  assert.ok((f.player.sampleHeldCommand().buttons&NET_BUTTONS.boost)!==0,'Sustained command lost the real boost latch');
  wireSpeed(30); // ordinary server refuses the Developer capability by default
  allowDeveloperBoost();wireSpeed(60); // standalone host explicitly grants it at boot
  setDev(false);assert.equal(f.player.sampleCommand().buttons&NET_BUTTONS.boost,0);assert.equal(f.player.sampleHeldCommand().buttons&NET_BUTTONS.boost,0);wireSpeed(30);
 }finally{try{client.dispose();}finally{try{room.dispose();}finally{try{host.dispose();}finally{f.dispose();}}}}
});
after(async()=>{try{setDev(false);await page.happyDOM.close();}finally{for(const [name,descriptor]of borrowed){if(descriptor===undefined)Reflect.deleteProperty(globalThis,name);else Object.defineProperty(globalThis,name,descriptor);}}});
