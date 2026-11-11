// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { app } from '../app/runtime';
import { GameMenu } from './Menu';
import type { FullMap } from './Map';
import { bindFlatTerrain } from '../../../test/engine/terrain';
import { installAssetTables } from '../../../shared/engine/boot/tables';

const tableSlot = Symbol.for('engine.asset-tables');
const previousTables = Object.getOwnPropertyDescriptor(globalThis, tableSlot);
beforeAll(() => { installAssetTables({ bytes: {}, versions: {}, music: {}, sfx: {}, packs: {} }); });
afterAll(() => {
  if (previousTables === undefined) Reflect.deleteProperty(globalThis, tableSlot);
  else Object.defineProperty(globalThis, tableSlot, previousTables);
});

const owners: Scope[]=[];
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();vi.restoreAllMocks();});

function fixture(){
  const owner=new Scope('lazy-settings');owners.push(owner);
  owner.onDispose(bindFlatTerrain());
  const map=legacyDouble<FullMap>({mount:()=>undefined,setZoom:()=>undefined,fit:()=>undefined,
    show:()=>undefined,hide:()=>undefined,hasRoom:false,zoom:1,quest:null});
  const menu=withOwner(owner,()=>new GameMenu({fullMap:map,settings:()=>({weapons:new Set(),melee:false,tracers:false,huntersEye:false})}));
  return {owner,menu};
}

test('first settings open synchronously keeps early sections and omits removed registrations',()=>{
  const {menu}=fixture(), first=document.createElement('div'), last=document.createElement('div'), removed=document.createElement('div');
  first.textContent='Early first';last.textContent='Early last';removed.textContent='Removed early';
  const refresh=vi.fn<()=>void>();
  menu.addSettingsSection('saves.game',[first],{first:true,refresh});
  const removeLast=menu.addSettingsSection('saves.game',[last]);
  menu.addSettingsSection('saves.game',[removed])();
  expect(menu.root.querySelector('.ws-gmenu-sv')).toBeNull();expect(refresh).not.toHaveBeenCalled();
  menu.open('settings');
  expect(document.querySelector('.ws-progress')).toBeNull();
  expect(first.isConnected).toBe(true);
  expect(last.isConnected).toBe(true);expect(removed.isConnected).toBe(false);
  expect(first.compareDocumentPosition(last)&Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(refresh).toHaveBeenCalled();
  removeLast();expect(last.isConnected).toBe(false);
  menu.close();const count=refresh.mock.calls.length;menu.open('settings');
  expect(refresh.mock.calls.length).toBeGreaterThan(count);
  expect(menu.root.textContent?.match(/Early first/gu)).toHaveLength(1);
});

test('closing never reopens the menu or changes the resumed app state',()=>{
  const {menu}=fixture();app.setState('play');
  menu.open('settings');menu.close();
  expect(document.querySelector('.ws-progress')).toBeNull();
  expect(menu.isOpen).toBe(false);expect(app.state).toBe('play');
});

test('retiring removes the synchronously mounted settings pane',()=>{
  const {owner,menu}=fixture();menu.open('settings');
  const pane=menu.root.querySelector('.ws-gmenu-sv');expect(pane?.isConnected).toBe(true);
  owner.dispose();
  expect(menu.root.isConnected).toBe(false);
  expect(pane?.isConnected).toBe(false);
});


test('the actual exit button reaches its host even when old menu cleanup would throw',()=>{
  const {menu}=fixture();app.setState('play');menu.open('settings');
  const leave=vi.fn<()=>void>();menu.onExit=leave;
  const close=vi.spyOn(menu,'close').mockImplementation(()=>{throw new Error('Old menu teardown refused');});
  const button=menu.root.querySelector<HTMLElement>('.ws-gmenu-exit');if(button===null)throw new Error('Missing exit button');
  button.click();expect(leave).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();
});

test('a menu without an exit host keeps its original silent local close',()=>{
  const {menu}=fixture();app.setState('play');menu.open('settings');
  const close=vi.spyOn(menu,'close');
  const button=menu.root.querySelector<HTMLElement>('.ws-gmenu-exit');if(button===null)throw new Error('Missing exit button');
  button.click();expect(close).toHaveBeenCalledExactlyOnceWith(true);expect(menu.isOpen).toBe(false);expect(app.state).toBe('play');
});
