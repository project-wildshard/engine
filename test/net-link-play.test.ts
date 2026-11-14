// EG-22: real pinned physics, real room/client codecs and delayed player commands.
// oxlint-disable-next-line import/no-nodejs-modules -- Immutable product and physics inputs.
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {expect,test} from 'vitest';
import {NetClient} from '../src/client/engine/net/client';
import {Predictor} from '../src/client/engine/net/predictor';
import {NetRoom} from '../src/server/engine/net/room';
import {SimNetWorld} from '../src/server/engine/net/simWorld';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder';
import {createTrustedHeadlessResident} from '../src/server/host/headlessRuntime';
import {leadPlayer} from '../src/shared/engine/sim/leadPlayer';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {PLAYER_CLASS} from '../src/shared/engine/net/netSchemas';
import {netPlayerCommand,stepResident} from '../src/shared/host/standalone/netInput';
import {ConditionedTransport,directLoopback} from '../src/test/engine/netLoopback';
import {builtFolder,runtimeAssets} from './fixtures/engine-lift/folder';

for(const profile of [{rtt:0,jitter:0,loss:0,reorder:0},{rtt:124,jitter:30,loss:2,reorder:2},{rtt:300,jitter:30,loss:2,reorder:5}])
  test(`a real walk and melee hold over ${profile.rtt} ms RTT`,async()=>{
    const directory=builtFolder('driftwood-isle'),product=await loadHeadlessFolder(directory);
    const input={product,shard:product.shardfile,assets:runtimeAssets(product,directory),rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))};
    const server=await createTrustedHeadlessResident(input,undefined,{room:true});
    let page:Awaited<ReturnType<typeof createTrustedHeadlessResident>>|undefined;
    const link=directLoopback();
    try {
      page=await createTrustedHeadlessResident(input,undefined,{room:true});
      const local=page,body=leadPlayer(local.host),lead=leadPlayer(server.host);
      // A real owned native body implements the prediction port. Replays move
      // only that character through its real motor, never the world or actors.
      const predictor=new Predictor({motionState:body,motor:body.motor,ride:null,renderOffset:new Vector3(),step:(command,replay)=>{
        if(replay)body.catchUp(command);else local.step([netPlayerCommand(command)]);
        return true;
      }},PLAYER_CLASS.owner);
      let seed=20261108;const random=():number=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      const conditions={latencyMs:profile.rtt/2,jitterMs:profile.jitter,lossPct:profile.loss,reorderPct:profile.reorder,random};
      const up=new ConditionedTransport(link.client,conditions),down=new ConditionedTransport(link.server,conditions);
      const client=new NetClient(up,()=>clock);let clock=0,frames=0,predicting=false,hits=0;
      const hold=():void=>{for(const live of [server,local])for(const actor of live.host.entities.values())actor.harnessHold=true;};
      const room=new NetRoom({world:new SimNetWorld(server.host),step:inputs=>{hold();stepResident(server,lead.id,inputs);}});room.open();room.join(down);
      client.onFrame(frame=>{frames++;if(predicting)predictor.reconcile(frame.lastSeq,frame.owner);else predictor.adopt(frame.lastSeq,frame.owner);});
      client.onCombat(event=>{if(event.kind==='hit'&&event.confirmFor!==0)hits++;});
      const passing=():void=>{clock+=1000/60;up.advance(1000/60);down.advance(1000/60);link.pump();};
      client.hello();for(let tick=0;tick<90;tick++){passing();room.tick();}
      expect(client.latest).not.toBeNull();const start=lead.position.clone();predicting=true;
      for(let tick=0;tick<165;tick++){
        hold();const command={viewTick:0,steer:{keyX:0,keyY:tick<120?1:0,stickX:0,stickY:0},yaw:product.shardfile.spawn.yaw,pitch:0,buttons:0};
        if(!predictor.full){const seq=client.command(command);predictor.step({...command,seq});}
        client.flush();passing();room.tick();
      }
      expect(lead.position.distanceTo(start)).toBeGreaterThan(6);
      expect(body.position.distanceTo(lead.position)).toBeLessThan(.25);
      // A metre is an overt player-visible teleport on this dry walking line.
      // This uses the predictor's public report, not its queue or saved-state layout.
      expect(predictor.missed.gap).toBeLessThan(1);
      predicting=false;
      const victim=[...server.host.entities.values()].find(actor=>actor.kind==='crab'&&actor.alive);
      if(victim===undefined)throw new Error('Actual Driftwood has no crab');
      const at=victim.position.clone(),y=server.host.groundHeightAt(at.x,at.z+1.4);
      lead.resetPose({x:at.x,y,z:at.z+1.4},0);const before=victim.hp;
      const pitch=Math.atan2(at.y+victim.dims.bodyY*victim.scale-(y+1.68),1.4);
      for(let tick=0;tick<150;tick++){
        const attack=tick===60?{attack:{aim:{origin:{x:0,y:0,z:0},direction:{x:0,y:0,z:-1}}}}:{};
        client.command({viewTick:0,steer:{keyX:0,keyY:0,stickX:0,stickY:0},yaw:0,pitch,buttons:0,...attack});
        client.flush();passing();room.tick();
      }
      expect(victim.hp).toBeLessThan(before);expect(hits).toBeGreaterThan(0);
      expect(frames).toBeGreaterThan(20);expect(client.closed).toBeNull();
      console.log(JSON.stringify({profile,frames,hits,corrections:predictor.corrections,gap:predictor.missed.gap}));
      room.dispose();client.dispose();
    }finally{link.client.close('done');page?.dispose();server.dispose();}
  },10_000);
