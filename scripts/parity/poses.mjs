import { join } from 'node:path';
import { poseAt, advance } from './frames.mjs';
import { percentile } from './value.mjs';

/** Convert authored standing cameras; free eye-only views belong to budgetViews, not player poses.
 * @param {Readonly<Record<string, { eye: readonly [number, number, number], feet?: readonly [number, number, number], yaw: number, pitch: number, probe?: import('../types/wildshard-probe.d.ts').ProbePose }>>} cameras
 * @returns {import('../types/wildshard-probe.d.ts').ProbePose[]} */
export function declaredProbePoses(cameras) {
  return Object.entries(cameras).flatMap(([name, camera]) => camera.probe ? [{ ...camera.probe, name: camera.probe.name ?? name }] : camera.feet ? [{ name, x: camera.feet[0], y: camera.feet[1], z: camera.feet[2], yaw: -camera.yaw * Math.PI / 180, pitch: camera.pitch * Math.PI / 180 }] : []);
}
/** @param {import('playwright').Page} page @param {{shard:string,tier:string,out:string,fast?:boolean}} opts */
export async function poses(page,opts) {
  const result=[];
  const cameras = await page.evaluate(async () => await window.__wildshard.requireWorld().game.level.capturePoses?.() ?? {});
  const authored = declaredProbePoses(cameras);
  for(const [index,pose] of (authored.length > 0 ? authored : [{ name: 'current' }]).entries()) {
    await poseAt(page,pose);
    await advance(page,90);
    // P1 fast omits pose observations, while keeping the exact full-profile game-time trajectory.
    if(opts.fast&&index>0){await advance(page,150);continue;}
    // scorecard's sampler: only frames whose game.frameNo moved are drawn frames.
    const sampled=await page.evaluate(async()=> {
      const g=window.__wildshard.requireWorld().game,iv=/** @type {number[]} */ ([]),cpu=/** @type {number[]} */ ([]),calls=/** @type {number[]} */ ([]),tris=/** @type {number[]} */ ([]);
      const instrument=window.__parity; instrument.cpu=0;instrument.on=true;
      const drawnNo=()=>Number(Reflect.get(g,'frameNo'));
      const wallNow=instrument.now??performance.now.bind(performance);
      let last=wallNow(),lastNo=drawnNo(),first=true;
      const sample=()=> {const now=wallNow();if(drawnNo()!==lastNo){if(!first){iv.push(now-last);cpu.push(instrument.cpu);}first=false;instrument.cpu=0;last=now;lastNo=drawnNo();calls.push(g.lastFrame.calls);tris.push(g.lastFrame.triangles);}};
      if(instrument.observe){const stop=instrument.observe(sample);try{await instrument.advance(150);}finally{stop();}}
      else {const end=drawnNo()+150;instrument.remaining=150;await new Promise((resolve)=>{const tick=()=>{sample();if(drawnNo()>=end)resolve(undefined);else instrument.rawRAF(tick);};instrument.rawRAF(tick);});}
      instrument.on=false;
      const p=window.__wildshard.requireWorld().player.position;
      return {iv,cpu,calls,tris,pos:[p.x,p.y,p.z]};
    });
    const boxes=await creatureBoxes(page);
    const shot=join(opts.out,`${opts.shard}.${opts.tier}.${pose.name ?? 'spawn'}.jpg`);
    await page.screenshot({path:shot,type:'jpeg',quality:80,scale:'css'});
    const mean=sampled.iv.reduce((sum,v)=>sum+v,0)/Math.max(1,sampled.iv.length);
    result.push({name:pose.name ?? 'spawn',pos:sampled.pos,calls:percentile(sampled.calls),tris:percentile(sampled.tris),fps:1000/mean,frameP95Ms:percentile(sampled.iv,0.95),cpuP50Ms:percentile(sampled.cpu),cpuP95Ms:percentile(sampled.cpu,0.95),creatureBoxes:boxes.length,boxes,shot,ssim:1});
  }
  return result;
}
/** Creature mask projection lifted from scorecard.mjs:576–600.
 * @param {import('playwright').Page} page */
function creatureBoxes(page) {
  return page.evaluate(()=> {
    const w=window.__wildshard.requireWorld(),cam=w.game.camera,W=innerWidth,H=innerHeight,out=/** @type {number[][]} */ ([]);
    cam.updateMatrixWorld();
    const right=w.player.position.clone().setFromMatrixColumn(cam.matrixWorld,0).normalize();
    for(const a of w.animals.animals){const m=a.mesh;if(!m.geometry.boundingSphere)m.geometry.computeBoundingSphere();const bs=m.geometry.boundingSphere;if(!bs)continue;
      const c=bs.center.clone().applyMatrix4(m.matrixWorld),r=Math.max(bs.radius*m.matrixWorld.getMaxScaleOnAxis(),0.8*a.scale),p=c.clone().project(cam);if(p.z>1 || p.z< -1)continue;
      const q=c.clone().addScaledVector(right,r).project(cam),sx=(p.x+1)/2*W,sy=(1-p.y)/2*H,pr=Math.hypot((q.x-p.x)/2*W,(q.y-p.y)/2*H)*1.25+6;
      const box=[Math.max(0,sx-pr),Math.max(0,sy-pr-34),Math.min(W,sx+pr),Math.min(H,sy+pr)];if(box[2]>box[0] && box[3]>box[1])out.push(box.map(Math.round));
    }
    return out;
  });
}
