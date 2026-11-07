// @vitest-environment happy-dom
import {expect,test} from 'vitest';
import {Scope} from '../../../shared/engine/app/scope';
import {pagePresentation} from '../app/view/presentation';
import {UiLayers} from './layers';

const view=(presentation?:'opaque'|'glass'|'world')=>({root:document.createElement('div'),back:()=>undefined,...(presentation===undefined?{}:{presentation})});
test('coverage metadata preserves input ownership while opaque, glass and world select presentation',()=>{
  const layers=new UiLayers(),scope=new Scope('layers-test');
  try{
    expect(layers.presentation).toBe('play');const menu=scope.child('menu'),glass=scope.child('glass');
    layers.push('menu',view(),menu);expect(layers.presentation).toBe('covered');expect(layers.blocking).toBe(true);
    layers.push('modal',view('glass'),glass);expect(layers.presentation).toBe('still');expect(layers.top).toBe('modal');
    glass.dispose();expect(layers.presentation).toBe('covered');menu.dispose();expect(layers.presentation).toBe('play');
    layers.push('modal',view('world'),scope);expect(layers.presentation).toBe('play');expect(layers.blocking).toBe(true);
  }finally{scope.dispose();}
});
test('loading cover parks without changing input, stacking or DOM styles',()=>{
  const layers=new UiLayers(),scope=new Scope('loading-cover'),loading=scope.child('loading');
  try{layers.holdCovered(loading);expect(layers.presentation).toBe('covered');expect(layers.top).toBe('hud');expect(layers.blocking).toBe(false);loading.dispose();expect(layers.presentation).toBe('play');}finally{scope.dispose();}
});
test('an opaque screen over a glass hold wins, and every close notifies the existing gate wake',()=>{
  const layers=new UiLayers(),scope=new Scope('layers-bind'),hold=scope.child('glass'),menu=scope.child('menu');let wakes=0;
  pagePresentation.bindGate(scope,()=>true);layers.bindPresentation(scope,()=>{wakes++;});
  try{layers.holdStill(hold);expect(pagePresentation.state).toBe('still');layers.push('menu',view(),menu);expect(pagePresentation.state).toBe('covered');menu.dispose();expect(pagePresentation.state).toBe('still');hold.dispose();expect(pagePresentation.state).toBe('play');expect(wakes).toBe(5);}finally{scope.dispose();}
});
