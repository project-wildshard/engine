// EG-27: real pinned worlds, actual codec bytes, and a third client that keeps playing.
// No refusal counters, queue shapes, or private rewind calls form the oracle.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the pinned physics binary.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {NetClient} from '../src/client/engine/net/client';
import {NetRoom} from '../src/server/engine/net/room';
import {SimNetWorld} from '../src/server/engine/net/simWorld';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {leadPlayer} from '../src/shared/engine/sim/leadPlayer';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder';
import {createTrustedHeadlessResident} from '../src/server/host/headlessRuntime';
import {stepResident} from '../src/shared/host/standalone/netInput';
import {directLoopback} from '../src/test/engine/netLoopback';
import {builtFolder,runtimeAssets} from './fixtures/engine-lift/folder';
import {Fuzz,Hostile} from './fixtures/net-hostile';

const seeds=(process.env['NET_FUZZ_SEEDS']??'20261108').split(',').map(Number);
for(const slug of ['sunscar-dunes','pine-hollow'])for(const seed of seeds)
  test(`hostile traffic leaves another player walking on ${slug}, seed ${seed}`,async()=>{
    const directory=builtFolder(slug),product=await loadHeadlessFolder(directory);
    const live=await createTrustedHeadlessResident({product,shard:product.shardfile,assets:runtimeAssets(product,directory),
      rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))},undefined,{room:true});
    const links:ReturnType<typeof directLoopback>[]=[];
    try {
      const {host}=live,lead=leadPlayer(host),world=new SimNetWorld(host);
      const room=new NetRoom({world,step:inputs=>{stepResident(live,lead.id,inputs);}});room.open();
      const seat=(id?:string):NetClient=>{
        const body=id===undefined?lead:host.addPlayer(id,{x:lead.position.x+4,y:lead.position.y,z:lead.position.z});
        const link=directLoopback();links.push(link);room.join(link.server,world.playerOf(body.id));
        const client=new NetClient(link.client,()=>0);client.hello('',{player:body.id,name:body.id});link.pump();return client;
      };
      const first=seat(),second=seat('hostile:peer'),clean=seat('honest:peer');
      const honest=host.players.get('honest:peer');if(honest===undefined)throw new Error('Missing admitted player');
      const start=honest.position.clone(),fuzz=new Fuzz(seed),attackers=[new Hostile(first),new Hostile(second)];let frames=0;
      clean.onFrame(()=>{frames++;});
      for(let tick=0;tick<180;tick++) {
        clean.command({viewTick:0,steer:{keyX:0,keyY:1,stickX:0,stickY:0},yaw:0,pitch:0,buttons:0});clean.flush();
        for(const [index,attacker] of attackers.entries())for(let burst=0;burst<3;burst++)
          links[index]?.client.send('reliable',attacker.any(fuzz,tick,['nobody','castaway.talk']));
        for(const link of links)link.pump();room.tick();for(const link of links)link.pump();
      }
      expect(frames).toBeGreaterThan(0);expect(clean.closed).toBeNull();
      expect(honest.position.distanceTo(start)).toBeGreaterThan(2);
    } finally {for(const link of links)link.client.close('done');live.dispose();}
  },10_000);
