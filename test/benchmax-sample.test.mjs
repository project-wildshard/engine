// Exercise the actual expressions injected by NB1, with a deterministic page
// clock and the game's frame-ring interface. No browser or module replacement.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the actual injected production expressions.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the page expressions with a deterministic frame clock.
import {runInNewContext} from 'node:vm';
import {expect,test} from 'vitest';

function sample({loseGlobals=false,changeWorld=false,noFrames=false}={}){
 const source=readFileSync('src/scripts/loading-flow/benchmax.mjs','utf8');
 const play=source.slice(source.indexOf('// the play: walk'),source.indexOf('// NB5: what the shadow'));
 const begin=/page\.evaluate(?:Handle)?\((`[^`]+`)\)/u.exec(play)?.[1];
 const finishSource=/(?:page|sample)\.evaluate\((`[^`]+`|(?:sample|captured) => \{[\s\S]*?\n {2}\})\)/u.exec(play)?.[1];
 expect(begin).toBeTypeOf('string');expect(finishSource).toBeTypeOf('string');
 let now=0,serial=0;
 const timers=new Map();
 const held=[];
 const g={get frameCount(){return noFrames?0:Math.floor(now/ (1000/30));},get frameI(){return this.frameCount%120;},
  frameMs:Array.from({length:120},()=>1000/30),updateMs:Array.from({length:120},()=>2),renderMs:Array.from({length:120},()=>3),
  lastFrame:{calls:100,triangles:900_000},renderer:{getPixelRatio:()=>2},app:{input:{setHeld:(...args)=>held.push(args)}}};
 const world={game:g,player:{position:{x:0,y:125,z:0},yaw:0,hover:false,setHover(){this.hover=true;}}};
 const window={__wildshard:{world}};
 const env={window,devicePixelRatio:2,performance:{now:()=>now},
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
 const expand=code=>code.startsWith('`')?runInNewContext(code,{seconds:60,route:null,values:{route:'spin'},shard:/Nine/u}):code;
 const state=runInNewContext(expand(begin),env);
 let removed=false;
 while(timers.size>0){
  const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
  if(timer.at>61_500)break;
  now=timer.at;timers.delete(id);timer.fn();
  if(loseGlobals&&!removed&&now>=30_000){delete window.__benchRows;removed=true;}
 }
 if(changeWorld)window.__wildshard.world={...world};
 const finish=runInNewContext(expand(finishSource),env);
 const result=typeof finish==='function'?finish(state):finish;
 return {result,held};
}

test('the street summary retains the frame ring, route and full minute',()=>{
 const {result,held}=sample();
 expect(result.route.name).toBe('spin');
 expect(result.minutes).toHaveLength(1);
 expect(result.all.fps).toBeGreaterThan(29);
 expect(result.all.fps).toBeLessThanOrEqual(30);
 expect(result.all.draws95).toBe(100);
 expect(result.all.tris95).toBe(900_000);
 expect(result.pixelRatio).toBe(2);
 expect(held.at(-1)).toEqual(['move.forward',false]);
});

test('losing the page globals cannot erase the owned street sample',()=>{
 expect(sample({loseGlobals:true}).result).toEqual(sample().result);
});

test('a replaced world refuses the sample rather than reporting another world',()=>{
 expect(()=>sample({changeWorld:true})).toThrow('benchmark world changed during play');
});
test('an empty frame ring is missing evidence and cannot become an empty reading',()=>{
 expect(()=>sample({noFrames:true})).toThrow('benchmark produced no drawn frames');
});
