// @vitest-environment happy-dom
import {expect,test} from 'vitest';
import {Scope} from '../../../shared/engine/app/scope';
import {pagePresentation} from '../app/view/presentation';
import {UiLayers,uiInputContext} from './layers';

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
test('QA row 15: <html data-ws-menu> marks a menu or panel over the world, so the chat row and its mic stand aside',()=>{
  const layers=new UiLayers(undefined,true),other=new UiLayers(),scope=new Scope('layers-menu'),root=document.documentElement;
  try{
    expect(root.dataset['wsMenu']).toBeUndefined();
    const talk=scope.child('talk');layers.push('modal',view('world'),talk);expect(layers.menuOpen).toBe(false);expect(root.dataset['wsMenu']).toBeUndefined();
    const bag=scope.child('bag');layers.push('gameMenu',view(),bag);expect(layers.menuOpen).toBe(true);expect(root.dataset['wsMenu']).toBe('open');
    // another stack (a resident shard's, a test's) neither sets nor clears the page's mark
    other.refresh();expect(root.dataset['wsMenu']).toBe('open');
    const shop=scope.child('shop');layers.push('modal',view('glass'),shop);expect(root.dataset['wsMenu']).toBe('open');
    shop.dispose();expect(root.dataset['wsMenu']).toBe('open');bag.dispose();expect(root.dataset['wsMenu']).toBeUndefined();
    layers.push('hud',{...view(),embedded:true},scope);expect(root.dataset['wsMenu']).toBeUndefined();
  }finally{scope.dispose();delete root.dataset['wsMenu'];}
});
test('QA 2026-11-11: <html data-ws-covered> marks a loading card over the world, so the chat corner stays away until it leaves',()=>{
  const layers=new UiLayers(undefined,true),other=new UiLayers(),scope=new Scope('layers-covered'),root=document.documentElement;
  try{
    expect(root.dataset['wsCovered']).toBeUndefined();
    const card=scope.child('card');layers.holdCovered(card);expect(root.dataset['wsCovered']).toBe('loading');
    other.refresh();expect(root.dataset['wsCovered']).toBe('loading');
    card.dispose();expect(root.dataset['wsCovered']).toBeUndefined();
    other.holdCovered(scope.child('other'));expect(root.dataset['wsCovered']).toBeUndefined();
  }finally{scope.dispose();delete root.dataset['wsCovered'];}
});
test('J457: <html data-ws-talk> marks an open NPC dialogue box, under a menu too, and leaves however the box closes',()=>{
  const layers=new UiLayers(undefined,true),other=new UiLayers(),scope=new Scope('layers-talk'),root=document.documentElement;
  try{
    expect(root.dataset['wsTalk']).toBeUndefined();
    const talk=scope.child('talk');const box=layers.push('modal',view('world'),talk);expect(layers.talkOpen).toBe(true);expect(root.dataset['wsTalk']).toBe('open');
    // a glass shop or the pause menu over the open box: still talking, and the menu mark joins it
    const pause=scope.child('pause');layers.push('menu',view(),pause);expect(root.dataset['wsTalk']).toBe('open');expect(root.dataset['wsMenu']).toBe('open');
    pause.dispose();expect(root.dataset['wsTalk']).toBe('open');expect(root.dataset['wsMenu']).toBeUndefined();
    other.refresh();expect(root.dataset['wsTalk']).toBe('open');
    // the box closes (NEXT on the last page, walking off, a fight that ends it): the mark goes
    box.dispose();expect(layers.talkOpen).toBe(false);expect(root.dataset['wsTalk']).toBeUndefined();
    // reopened, then its owner goes (the shard leaves): the mark goes too
    const again=scope.child('again');layers.push('modal',view('world'),again);expect(root.dataset['wsTalk']).toBe('open');again.dispose();expect(root.dataset['wsTalk']).toBeUndefined();
    // a glass or opaque screen alone is never a talk
    const shop=scope.child('shop');layers.push('modal',view('glass'),shop);expect(root.dataset['wsTalk']).toBeUndefined();shop.dispose();
  }finally{scope.dispose();delete root.dataset['wsTalk'];delete root.dataset['wsMenu'];}
});

test('J473 (Jake, 2026-11-19: FIRE, AIM, DODGE and JUMP stay live in a talk): a dialogue box takes the dialog context, a menu over it the menu context',()=>{
  expect(uiInputContext(false,false,true)).toBe('');
  expect(uiInputContext(true,false,true)).toBe('dialog');
  expect(uiInputContext(true,true,true)).toBe('menu');
  expect(uiInputContext(true,false,false)).toBe('menu');
});

test('QA 11-24 row 17: the game menu (the Bag) at the front is a game menu over play; a modal over it or a loading cover is not',()=>{
  const layers=new UiLayers(),scope=new Scope('game-menu-front');
  try{
    expect(layers.gameMenuFront).toBe(false);
    const bag=scope.child('bag');layers.push('gameMenu',view(),bag);expect(layers.gameMenuFront).toBe(true);
    const modal=scope.child('modal');layers.push('modal',view('glass'),modal);expect(layers.gameMenuFront).toBe(false);modal.dispose();
    expect(layers.gameMenuFront).toBe(true);
    const loading=scope.child('loading');layers.holdCovered(loading);expect(layers.gameMenuFront).toBe(false);loading.dispose();
    bag.dispose();expect(layers.gameMenuFront).toBe(false);
  }finally{scope.dispose();}
});
