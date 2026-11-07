import {expect,test} from 'vitest';
import {readNalatiWeaponObservation} from './fixtures/nalati-weapon-observation';

test('native weapon observations read fresh detached values from the real string envelope',()=>{
  let state={version:1,slot:'bow',bolts:24,enabled:true,unselected:{moves:[]}};
  const owner={snapshot:()=>JSON.stringify(state)},first=readNalatiWeaponObservation(owner);
  expect(first).toStrictEqual({version:1,slot:'bow',bolts:24,enabled:true});
  state={...state,slot:'blade',bolts:23,enabled:false};
  expect(readNalatiWeaponObservation(owner)).toStrictEqual({version:1,slot:'blade',bolts:23,enabled:false});
  expect(first).toStrictEqual({version:1,slot:'bow',bolts:24,enabled:true});
});
test('native weapon observation keeps the original enabled default and refuses foreign envelopes',()=>{
  expect(readNalatiWeaponObservation({snapshot:()=>JSON.stringify({version:1,slot:'bow',bolts:24})}).enabled).toBe(true);
  expect(()=>readNalatiWeaponObservation({snapshot:()=>({version:1,slot:'bow',bolts:24})})).toThrow('JSON envelope');
  for(const state of [{version:2,slot:'bow',bolts:24},{version:1,slot:'bow',bolts:-1},{version:1,slot:'bow',bolts:.5},{version:1,slot:'bow'}])
    expect(()=>readNalatiWeaponObservation({snapshot:()=>JSON.stringify(state)})).toThrow();
  expect(()=>readNalatiWeaponObservation({snapshot:()=>'{'})).toThrow();
});
