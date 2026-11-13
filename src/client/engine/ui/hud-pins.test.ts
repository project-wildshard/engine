// @vitest-environment happy-dom
import {afterEach,expect,test} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import type {Game} from '../core/Game';
import type {SystemSpec} from '../app/systems';
import {Scope} from '../../../shared/engine/app/scope';
import {installBrowserScopeEnvironment} from '../app/view/scopeEnvironment';
import {legacyDouble} from '../../../test/engine/FakeGame';
import {frameEye,framedPoint,hudAdapters,pinFrameOffset} from './hudAdapters';
import {hudSlots} from './hudSlots';

const originalWidth=Object.getOwnPropertyDescriptor(globalThis,'innerWidth');
const originalHeight=Object.getOwnPropertyDescriptor(globalThis,'innerHeight');
const originalSlots=hudSlots.snapshot();
afterEach(()=>{
 for(const [name,descriptor] of [['innerWidth',originalWidth],['innerHeight',originalHeight]] as const){
  if(descriptor===undefined)Reflect.deleteProperty(globalThis,name);else Object.defineProperty(globalThis,name,descriptor);
 }
 hudSlots.restore(originalSlots);
 pinFrameOffset.set(0,0,0);
});
function fixture(){
 installBrowserScopeEnvironment();
 let width=402,height=874,widthReads=0,heightReads=0,rendererReads=0,run:SystemSpec['run']|undefined;
 Object.defineProperty(globalThis,'innerWidth',{configurable:true,get:()=>{widthReads++;return width;}});
 Object.defineProperty(globalThis,'innerHeight',{configurable:true,get:()=>{heightReads++;return height;}});
 const camera=new PerspectiveCamera(72,width/height,.1,100);camera.updateMatrixWorld();
 const app=legacyDouble<Game['app']>({addSystem:spec=>{run=spec.run;}});
 const renderer=legacyDouble<Game['renderer']>({getSize:target=>{rendererReads++;return target.set(width,height);}});
 const game=legacyDouble<Game>({camera,app,renderer,level:legacyDouble<Game['level']>({hud:{}})});
 const scope=new Scope('pin owner'),root=document.createElement('div');document.body.append(root);
 const hud=hudAdapters(game,scope,root,()=>undefined);
 return {hud,scope,root,camera,reads:()=>[widthReads,heightReads],rendererReads:()=>rendererReads,resize:(w:number,h:number)=>{width=w;height=h;},
  step:()=>{if(run===undefined)throw new Error('Native pin system was not installed');run(1/60,0);},
  close:()=>{scope.dispose();root.remove();}};
}

test('projected pins keep live reader order, null/removal effects and next-frame viewport resize',()=>{
 const f=fixture(),a=document.createElement('div'),b=document.createElement('div'),order:string[]=[];
 let active=true,removeSecond=false;
 let releaseSecond:()=>void=()=>undefined;
 f.hud.pin(()=>{order.push('a');if(removeSecond)releaseSecond();return active?new Vector3(0,0,-10):null;},a);
 releaseSecond=f.hud.pin(()=>{order.push(`b:${a.style.display}`);return active?new Vector3(0,0,-10):null;},b);
 try{
  f.step();expect(order).toEqual(['a','b:block']);expect(a.style.transform).toBe('translate3d(201px, 437px, 0) translate(-50%, -50%)');
  expect(f.reads()).toEqual([0,0]);expect(f.rendererReads()).toBe(1);
  f.resize(800,600);f.step();expect(a.style.transform).toBe('translate3d(400px, 300px, 0) translate(-50%, -50%)');
  expect(f.reads()).toEqual([0,0]);expect(f.rendererReads()).toBe(2);
  active=false;f.step();expect(a.style.display).toBe('none');expect(b.style.display).toBe('none');expect(f.reads()).toEqual([0,0]);expect(f.rendererReads()).toBe(2);
  order.length=0;removeSecond=true;active=true;f.step();expect(order).toEqual(['a']);expect(b.isConnected).toBe(false);
 }finally{f.close();}
});

test('control avoidance and shown-pin size reads retain their original refresh cadence',()=>{
 const f=fixture(),layer=document.createElement('div'),button=document.createElement('button'),status=document.createElement('div');
 layer.className='ws-touch';layer.append(button);f.root.append(layer,status);button.style.opacity='1';
 let controls=0,sizes=0;
 button.getBoundingClientRect=()=>{controls++;return new DOMRect(160,400,80,80);};
 hudSlots.mount(layer,status);
 const el=document.createElement('div');
 Object.defineProperty(el,'offsetWidth',{get:()=>{sizes++;return 20;}});Object.defineProperty(el,'offsetHeight',{get:()=>20});
 f.hud.pin(new Vector3(0,0,-10),el);
 try{
  f.step();expect(el.style.transform).toBe('translate3d(201px, 394px, 0) translate(-50%, -50%)');expect(sizes).toBe(0);
  f.step();expect(el.style.transform).toBe('translate3d(201px, 384px, 0) translate(-50%, -50%)');expect(sizes).toBe(1);
  for(let i=0;i<14;i++)f.step();expect(sizes).toBe(1);expect(controls).toBe(2);
  f.step();expect(sizes).toBe(2);expect(controls).toBe(3);
 }finally{f.close();}
});

// QA 2026-11-13 (Jake, preview, Sky Reach, iPhone): facing away from the Keeper, "◆ KEEPER 88 M" stood ahead over the bridge
// while the quest chip's arrow pointed behind; facing him, no pin. Sky Reach was a grid frame one pitch south of the page's
// home: the live session stands the camera at the frame's render offset, and the pin's frame-local point was projected
// without it, 562.5 m off, so a Keeper behind drew ahead and one ahead fell behind.
const PITCH=562.5,KEEPER=new Vector3(0,30,-88);
function face(camera:PerspectiveCamera,offsetZ:number,yaw:number){
 camera.far=2600;camera.updateProjectionMatrix();
 camera.position.set(0,31.7,offsetZ);camera.rotation.set(0,yaw,0,'YXZ');camera.updateMatrixWorld();
}
test('a pin behind the camera never draws in the view; turned round, it stands in the middle',()=>{
 const f=fixture(),el=document.createElement('div');f.hud.pin(KEEPER,el);
 try{
  face(f.camera,0,Math.PI);f.step();expect(el.style.display).toBe('none');
  face(f.camera,0,0);f.step();expect(el.style.display).toBe('block');expect(el.style.transform).toMatch(/^translate3d\(201px, 4\d\dpx, 0\)/u);
 }finally{f.close();}
});
test('in a grid frame a pin projects its frame-local point at the frame\'s render offset',()=>{
 const f=fixture(),el=document.createElement('div');f.hud.pin(KEEPER,el);
 pinFrameOffset.set(0,0,-PITCH);
 try{
  face(f.camera,-PITCH,Math.PI);f.step();expect(el.style.display).toBe('none');
  face(f.camera,-PITCH,0);f.step();expect(el.style.display).toBe('block');expect(el.style.transform).toMatch(/^translate3d\(201px, 4\d\dpx, 0\)/u);
 }finally{f.close();}
});
// QA 2026-11-13 row 28: the grapple's in-view test, riding's name tags and the loot chip project with the page camera too
test('framedPoint and frameEye put a frame-local point and the eye in one frame at the grid offset',()=>{
 const camera=new PerspectiveCamera(72,402/874,.1,100);
 face(camera,-PITCH,0);pinFrameOffset.set(0,0,-PITCH);
 const ahead=(point:Vector3)=>point.clone().applyMatrix4(camera.matrixWorldInverse).z<0;
 // the frame-local point straight, as those three did: 474.5 m behind the eye, though the Keeper stands ahead
 expect(ahead(KEEPER)).toBe(false);
 const seen=framedPoint(KEEPER,new Vector3());
 expect(seen.toArray()).toEqual([0,30,-88-PITCH]);
 expect(ahead(seen)).toBe(true);
 const ndc=seen.clone().project(camera);
 expect(Math.abs(ndc.x)).toBeLessThan(.01);expect(ndc.z).toBeGreaterThan(-1);expect(ndc.z).toBeLessThan(1);
 const eye=frameEye(camera,new Vector3());
 expect(eye.toArray()).toEqual([0,31.7,0]);
 expect(eye.distanceTo(KEEPER)).toBeCloseTo(88.016,2);
 expect(camera.position.toArray()).toEqual([0,31.7,-PITCH]); // the camera itself is never moved
 pinFrameOffset.set(0,0,0);
 expect(framedPoint(KEEPER,new Vector3()).toArray()).toEqual(KEEPER.toArray());
 expect(frameEye(camera,new Vector3()).toArray()).toEqual(camera.position.toArray());
});
