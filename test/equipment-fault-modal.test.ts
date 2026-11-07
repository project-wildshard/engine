// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {Group} from 'three';
import {Scope} from '../src/shared/engine/app/scope';
import {Weapon} from '../src/shared/engine/combat/Weapon';
import type {EquipmentRow} from '../src/shared/engine/combat/Equipment';
import {EquipmentService} from '../src/client/engine/combat/EquipmentService';
import {installErrorModal} from '../src/client/engine/ui/ErrorModal';
import {isDev,setDev} from '../src/client/engine/core/devMode';
import {emitFault,setLoopState,onFault,type Fault} from '../src/shared/engine/core/faults';
import {bindClientChannelInputs} from '../src/shared/game/plugin/channels';
import {SWORD_WOOD} from '../src/shared/game/weapons/starterMeleeProfile';

class TestWeapon extends Weapon {
  readonly model=new Group();
  readonly state={ammo:3,magazine:3,reserve:9,loaded:true,reloading:false,reloadProgress:0,ads:false};
  adsHeld=false;aimInfo=null;enabled=true;holster=0;
  readonly tick=vi.fn();
  tryFire():void{this.state.ammo--;}
  update():void{this.tick();}
}
// G901: a recoverable report opens the full modal only with Developer on (the public build shows the chip,
// src/client/engine/ui/error-modal-public.test.ts); both contracts here are the Developer modal's
const previousDeveloper=isDev();
beforeEach(()=>{setDev(true);});
afterEach(()=>{setDev(previousDeveloper);});
const weaponRow=(id:EquipmentRow['id'],slot:'bow'|'sword'):EquipmentRow=>({...SWORD_WOOD,id,legacySlot:slot});

test('with Developer on, a NaN crossbow frame skips only that weapon and opens the existing error modal',()=>{
  vi.useFakeTimers();
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(new Response('{}',{status:200,headers:{'content-type':'application/json'}}))));
  const scope=new Scope('equipment-modal-test'),crossbow=new TestWeapon(weaponRow('weapon.crossbow','bow')),
    sword=new TestWeapon(weaponRow('weapon.sword','sword')),service=new EquipmentService(crossbow,{scope});
  service.add(sword,{locked:false});
  const state={draw:1},read=bindClientChannelInputs([{input:'draw',owner:'weapon',path:['draw']}],new Map([['weapon',state]]),new Set(['draw'])).get('draw');
  if(read===undefined)throw new Error('Missing actual draw channel');
  const applied=vi.fn();crossbow.tick.mockImplementation(()=>{read();applied();});
  const reports:Fault[]=[],stop=onFault(fault=>{reports.push(fault);});
  setLoopState('running');installErrorModal();
  try{
    state.draw=Number.NaN;
    expect(()=>service.update(1/60,0)).not.toThrow();
    expect(applied).not.toHaveBeenCalled();expect(sword.tick).toHaveBeenCalledOnce();
    expect(document.querySelector('#wserr[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('#wserr .what')?.textContent).toContain('equipment.weapon.crossbow');
    expect(document.querySelector('#wserr .what')?.textContent).toContain('Invalid numeric input draw');
    expect(reports.map(fault=>fault.verdict)).toEqual(['uncaught']);
    document.querySelector<HTMLButtonElement>('#wserr .keep')?.click();
    state.draw=1;service.update(1/60,1/60);
    expect(applied).toHaveBeenCalledOnce();expect(sword.tick).toHaveBeenCalledTimes(2);
    state.draw=Number.NaN;
    for(let frame=2;frame<8;frame++)service.update(1/60,frame/60);
    expect(crossbow.tick).toHaveBeenCalledTimes(8);expect(sword.tick).toHaveBeenCalledTimes(8);
    expect(reports).toHaveLength(1);expect(service.enabled).toBe(true);
  }finally{stop();scope.dispose();setLoopState('boot');vi.clearAllTimers();vi.useRealTimers();}
});


test('a later fatal report retires the existing modal resume action',()=>{
  vi.useFakeTimers();setLoopState('running');installErrorModal();
  try{
    emitFault({system:'test.core',error:new Error('initial core fault'),verdict:'uncaught'});
    const keep=document.querySelector<HTMLButtonElement>('#wserr .keep');
    if(keep===null)throw new Error('Missing existing modal action');
    expect(keep.hidden).toBe(false);
    setLoopState('dead');emitFault({system:'test.core',error:new Error('fatal core fault'),verdict:'fatal'});
    expect(keep.hidden).toBe(true);keep.click();
    expect(document.querySelector('#wserr[role="alertdialog"]')).not.toBeNull();
  }finally{setLoopState('running');document.querySelector<HTMLButtonElement>('#wserr .keep')?.click();setLoopState('boot');vi.clearAllTimers();vi.useRealTimers();}
});
