// @vitest-environment node
import {expect,test} from 'vitest';
import {beginFolderSession,openFolderSession} from './fixtures/headless/folderSession';
import {decodeSimSnapshotBytes} from '../src/shared/engine/sim/snapshot';
import type {HeadlessTickCommit} from '../src/shared/host/tickProtocol';

function doorState(commit:HeadlessTickCommit){
  const saved=decodeSimSnapshotBytes(commit.snapshot),row=saved.adapters.find(adapter=>adapter.id==='pine.doors');
  if(row===undefined)throw new Error('Missing real door continuation');return row.state;
}

// QA 11-25 row 59: under the full suite's load the two worker boots (about 3 s each when idle) took most of the 30 s. The
// restored worker now boots, imports and admits the product while the original walks to the porch; only its payload waits
// for the opened door's checkpoint, which is still the one restore the test proves.
test('the actual moving cabin leaf reconnects its existing physics handles and continues after restore',async()=>{
  const started=performance.now();
  const stage=(name:string)=>{console.info('pine-door-stage',JSON.stringify({name,milliseconds:performance.now()-started}));};
  let give:(snapshot:string)=>void=()=>undefined,refuse:(error:Error)=>void=()=>undefined;
  const checkpoint=new Promise<string>((resolve,reject)=>{give=resolve;refuse=reject;});
  const [original,restoring]=await Promise.all([openFolderSession('pine-hollow','pine-verbs'),beginFolderSession('pine-hollow','pine-verbs',checkpoint)]);
  stage('original-ready');
  try{
    await original.sim.walkLeg({ticks:6000,once:true,points:[[0,-190],[-8,-150],[-30,-95],[-12,-52],[-1,-40],[-5.71,-31.7],[-7.99,-35.02],[-9.56,-34.66]].map(([x,z])=>{
      if(x===undefined||z===undefined)throw new Error('Missing actual porch waypoint');return {x,z};
    })});
    stage('walk-complete');
    const opened=await original.sim.step([{source:'door.use',commands:[{kind:'script',actorId:'pine.door',value:0}]}]);
    stage('opened');
    give(opened.snapshot);
    const restored=await restoring.ready();
    stage('restored-ready');
    const [continued,replayed]=await Promise.all([original.sim.step(),restored.step()]);
    stage('continued');
    expect(continued.tick).toBe(opened.tick+1);expect(replayed.tick).toBe(continued.tick);
    const replayedDoor=doorState(replayed),continuedDoor=doorState(continued),openedDoor=doorState(opened);
    expect(replayedDoor).toEqual(continuedDoor);
    expect(replayedDoor).not.toEqual(openedDoor);
    expect(original.sim.quarantined).toBe(false);expect(restored.quarantined).toBe(false);
    stage('checked');
  }finally{
    refuse(new Error('The original stopped before it opened the door'));
    await original.sim.dispose();await restoring.ready().then(sim=>sim.dispose(),()=>undefined);stage('disposed');
  }
},30_000);
