// Fixed native fixture for the cumulative reply cap, not caller-selected code.
import {readFileSync} from 'node:fs';
import {createSimHost} from '../../../src/server/engine/sim.ts';
import {loadRapier} from '../../../src/shared/engine/physics/rapier.ts';
import {serializeSimSnapshot,snapshotSimHostBytes} from '../../../src/shared/engine/sim/snapshot.ts';
import {runTickWorker} from '../../../src/server/host/tickWorkerLoop.ts';
import {createTrustedHeadlessTape} from '../../../src/shared/host/headlessTape.ts';
import {simPlayerCommand} from '../../../src/shared/host/tickProtocol.ts';
import {SIM_LEVEL} from '../sim-level/level.ts';
await runTickWorker(async()=>{
 const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm')),host=createSimHost({...SIM_LEVEL,entities:[]},{rapier});
 for(let index=0;index<6;index++)host.onStep(`wide-${index}`,()=>undefined,{snapshot:()=>({text:'x'.repeat(500_000)}),restore:()=>undefined});
 const step=commands=>{const player=commands.find(row=>row.kind==='player');host.step(player===undefined?undefined:simPlayerCommand(player));};
 const tape=createTrustedHeadlessTape(host,step,()=>[]);
 return {step,verbTape:tape,commit:()=>({tick:host.state.tick,snapshot:serializeSimSnapshot(snapshotSimHostBytes(host)),effects:[]}),
  finish:()=>({ticks:host.state.tick,lanes:0,steps:0}),dispose:()=>host.dispose()};
});
