import {expect,test} from 'vitest';
import {Color,Fog,PerspectiveCamera,Scene} from 'three';
import {Scope} from '@wildshard/engine/app/scope';
import {GridFrame} from './frame';

test('live fog and grade remain fresh across draws, withdrawal and replacement',()=>{
  const scope=new Scope('frame.air'),scene=new Scene(),camera=new PerspectiveCamera();scene.fog=new Fog(new Color(.2,.3,.4),1,1000);
  const home={instance:'home',origin:{x:0,z:0}},next={instance:'next',origin:{x:555,z:0}};
  const frame=new GridFrame({scope,host:{scene,camera,composer:()=>{throw new Error('Not installed');},post:()=>null},cells:[home,next],home,half:250,feet:()=>next.origin});
  frame.declare('next',{haze:{colour:[.1,.2,.3]}});
  const fog=new Fog(new Color(),1,1000),grade={exposure:1,saturation:.8,contrast:1.1};
  let release=frame.contribute('next',{fog,grade});
  const draw=():void=>{Reflect.apply(scene.onBeforeRender.bind(scene),scene,[]);};
  try{
    frame.frame();fog.color.setRGB(.7,.5,.2);draw();
    const first=frame.state();expect(first.air).toEqual([.7,.5,.2]);expect(first.grade.slice(0,3)).toEqual([1,.8,1.1]);
    expect([fog.color.r,fog.color.g,fog.color.b]).toEqual([.1,.2,.3]);
    fog.color.setRGB(.4,.6,.8);grade.exposure=2;frame.frame();draw();
    expect(frame.state().air).toEqual([.4,.6,.8]);expect(frame.state().grade[0]).toBe(2);expect(first.air).toEqual([.7,.5,.2]);
    release();frame.frame();draw();expect(frame.state().air).toEqual([.1,.2,.3]);
    const other=new Fog(new Color(),1,1000);release=frame.contribute('next',{fog:other});
    other.color.setRGB(.9,.1,.5);frame.frame();draw();expect(frame.state().air).toEqual([.9,.1,.5]);
  }finally{release();scope.dispose();}
});

test('a nested fog getter cannot overwrite the outer draw home-air snapshot',()=>{
  const scope=new Scope('frame.nested-air'),scene=new Scene(),camera=new PerspectiveCamera(),fog=new Fog(new Color(.2,.3,.4),1,1000);scene.fog=fog;
  const home={instance:'home',origin:{x:0,z:0}},next={instance:'next',origin:{x:555,z:0}};
  const frame=new GridFrame({scope,host:{scene,camera,composer:()=>{throw new Error('Not installed');},post:()=>null},cells:[home,next],home,half:250,feet:()=>({x:305,z:0})});
  const draw=():void=>{Reflect.apply(scene.onBeforeRender.bind(scene),scene,[]);};let armed=true;
  const release=frame.contribute('next',{get fog(){if(armed){armed=false;fog.color.setRGB(.8,.7,.6);draw();}return null;}});
  try{frame.frame();draw();expect(frame.state().air).toEqual([.575,.43,.42]);}
  finally{release();scope.dispose();}
});
