import {expect,test} from 'vitest';
import {readCaps} from '../src/scripts/budgets/files.mjs';
import {nineFaults,type NineReading} from '../src/scripts/loading-flow/nine-ratchet.mjs';

// BUDGET-CAPS BC11: the street's triangles and draws are judged against Nine's recorded baseline plus 10% (J444).
const judging={contentKey:'nine-dragon-stack@3',budgets:{caps:readCaps(),baselines:{schema:1,about:'',baselines:{
  'nine/street/triangles95':{value:904_000,contentKey:'nine-dragon-stack@3'},'nine/street/draws95':{value:119,contentKey:'nine-dragon-stack@3'}}}}};
const DRAWS_OVER=131, TRIANGLES_OVER=995_000;
const faults=(r:NineReading,j:typeof judging=judging)=>nineFaults(r,j);

const frame = {fps:29,p95:49,gpu95:15,draws95:119,tris95:904_000};
const reading = ():NineReading => ({renderer:'Apple M5 Pro',seconds:60,throttle:4,dpr:2,phone:true,
  load:{phases:{control:24_500},stage:[{op:'stage:shaders',ms:900},{op:'stage:firstFrame',ms:1500}]},
  play:{pixelRatio:2,all:{...frame},minutes:[{...frame}],route:{name:'nine',reached:30,stuck:[],path:[[0,5,-90],[1000,35,5]]}}});

test('tonight\'s street measurements pass; either geometry regression fails even on software GPU',()=>{
  expect(faults(reading())).toEqual([]);
  for(const renderer of ['Apple M5 Pro','ANGLE (SwiftShader Device)']){
    const draws = reading();draws.renderer=renderer;draws.play.minutes=[{...frame,draws95:DRAWS_OVER}];
    expect(faults(draws).join('; ')).toContain('draws p95');
    const triangles = reading();triangles.renderer=renderer;triangles.play.all.tris95=TRIANGLES_OVER;
    expect(faults(triangles).join('; ')).toContain('triangles p95');
  }
});

test('missing, wedged, short or wrong-tier evidence cannot turn the gate green',()=>{
  for(const mutate of [
    (r:NineReading)=>{r.play.route.path=[];},(r:NineReading)=>{r.play.minutes=[];},
    (r:NineReading)=>{r.play.route.stuck=[1,2,3];},(r:NineReading)=>{r.seconds=30;},
    (r:NineReading)=>{r.play.all.tris95=Number.NaN;},(r:NineReading)=>{r.play.pixelRatio=1;},
    (r:NineReading)=>{r.play.route.name='spin';},(r:NineReading)=>{r.phone=false;},
  ]){const r=reading();mutate(r);expect(faults(r).length).toBeGreaterThan(0);}
});

test('removing tonight\'s far slab cut (+12%) trips the measured street ratchet',()=>{
  const r=reading();r.play.all.tris95=1_013_000;
  expect(faults(r).join('; ')).toContain('triangles p95');
});

test('bringing back twelve merged hoverboard draws trips the street ratchet',()=>{
  const r=reading();r.play.all.draws95=DRAWS_OVER;
  expect(faults(r).join('; ')).toContain('draws p95');
  // under the 10% line is silent, and a new Nine revision is new content
  r.play.all.draws95=130;expect(faults(r)).toEqual([]);
  r.play.all.draws95=200;expect(faults(r,{...judging,contentKey:'nine-dragon-stack@4'})).toEqual([]);
});

test('hardware holds frame and load numbers, software still holds submitted work',()=>{
  const r=reading();r.play.all.fps=12;r.play.all.p95=90;r.load.phases.control=60_000;
  expect(faults(r).join('; ')).toMatch(/fps.*frame p95.*control ms/u);
  r.renderer='ANGLE (SwiftShader Device)';expect(faults(r)).toEqual([]);
  r.play.all.draws95=0;expect(faults(r).join('; ')).toContain('draws p95');
});

// Run 44040033228, street artifact 14309234027: hosted macOS uses
// Apple's virtual GPU, not the physical MacBook that set NB6's limits.
test('hosted Paravirtual GPU observes timing while holding route and geometry',()=>{
  const r=reading();
  r.renderer='ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)';
  r.play.all={fps:4.21861439449197,p95:100,gpu95:55.39999961853027,draws95:101,tris95:843_148};
  r.play.minutes=[{...r.play.all,fps:4.366666666666666,draws95:101,tris95:843148}];
  r.load.phases.control=75_138.4;
  r.load.stage=[{op:'stage:shaders',ms:1200},{op:'stage:firstFrame',ms:9288.2}];
  expect(faults(r)).toEqual([]);
  const hardware={...r,renderer:'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)'};
  expect(faults(hardware).join('; ')).toMatch(/fps.*frame p95.*gpu~ p95.*control ms.*firstFrame ms/u);
  r.play.all.draws95=DRAWS_OVER;
  expect(faults(r).join('; ')).toContain('draws p95');
  r.play.all.tris95=TRIANGLES_OVER;
  expect(faults(r).join('; ')).toContain('triangles p95');
  r.play.route.path=[];
  expect(faults(r).join('; ')).toContain('street route incomplete');
});
