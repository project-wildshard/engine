import {expect,test} from 'vitest';
import {nineFaults,NINE_LIMITS,type NineReading} from '../scripts/loading-flow/nine-ratchet.mjs';

const frame = {fps:29,p95:49,gpu95:15,draws95:119,tris95:904_000};
const reading = ():NineReading => ({renderer:'Apple M5 Pro',seconds:60,throttle:4,dpr:2,phone:true,
  load:{phases:{control:24_500},stage:[{op:'stage:shaders',ms:900},{op:'stage:firstFrame',ms:1500}]},
  play:{pixelRatio:2,all:{...frame},minutes:[{...frame}],route:{name:'nine',reached:30,stuck:[],path:[[0,5,-90],[1000,35,5]]}}});

test('tonight\'s street measurements pass; either geometry regression fails even on software GPU',()=>{
  expect(nineFaults(reading())).toEqual([]);
  for(const renderer of ['Apple M5 Pro','ANGLE (SwiftShader Device)']){
    const draws = reading();draws.renderer=renderer;draws.play.minutes=[{...frame,draws95:NINE_LIMITS.draws95+1}];
    expect(nineFaults(draws).join('; ')).toContain('draws p95');
    const triangles = reading();triangles.renderer=renderer;triangles.play.all.tris95=NINE_LIMITS.triangles95+1;
    expect(nineFaults(triangles).join('; ')).toContain('triangles p95');
  }
});

test('missing, wedged, short or wrong-tier evidence cannot turn the gate green',()=>{
  for(const mutate of [
    (r:NineReading)=>{r.play.route.path=[];},(r:NineReading)=>{r.play.minutes=[];},
    (r:NineReading)=>{r.play.route.stuck=[1,2,3];},(r:NineReading)=>{r.seconds=30;},
    (r:NineReading)=>{r.play.all.tris95=Number.NaN;},(r:NineReading)=>{r.play.pixelRatio=1;},
    (r:NineReading)=>{r.play.route.name='spin';},(r:NineReading)=>{r.phone=false;},
  ]){const r=reading();mutate(r);expect(nineFaults(r).length).toBeGreaterThan(0);}
});

test('hardware holds frame and load numbers, software still holds submitted work',()=>{
  const r=reading();r.play.all.fps=12;r.play.all.p95=90;r.load.phases.control=60_000;
  expect(nineFaults(r).join('; ')).toMatch(/fps.*frame p95.*control ms/u);
  r.renderer='ANGLE (SwiftShader Device)';expect(nineFaults(r)).toEqual([]);
  r.play.all.draws95=0;expect(nineFaults(r).join('; ')).toContain('draws p95');
});
