import {expect,test} from 'vitest';
import {restoreEncounterBrains} from './fixtures/restoreEncounterBrains';

test('a restored shared bank retains each entered encounter callback identity without executing it',()=>{
  const actor={},other={},calls:number[]=[],brain={think:()=>{calls.push(1);}},foreign={think:()=>{calls.push(2);}};
  const owned=new Map([[actor,brain]]),shared=new Map([[actor,brain],[other,foreign]]);
  shared.clear();shared.set(other,foreign);
  restoreEncounterBrains(owned,shared,body=>body===actor);
  expect(shared.get(actor)).toBe(brain);expect(shared.get(other)).toBe(foreign);expect(calls).toEqual([]);
  shared.get(actor)?.think();expect(calls).toEqual([1]);
  restoreEncounterBrains(owned,shared,body=>body===actor);expect(shared.size).toBe(2);
});
test('a competing or retired body refuses before reconnecting any earlier callback',()=>{
  const a={},b={},first={},second={},foreign={},owned=new Map([[a,first],[b,second]]);
  const shared=new Map([[b,foreign]]);
  expect(()=>restoreEncounterBrains(owned,shared,()=>true)).toThrow('Changed encounter');
  expect(shared.has(a)).toBe(false);expect(shared.get(b)).toBe(foreign);
  shared.clear();expect(()=>restoreEncounterBrains(owned,shared,body=>body!==b)).toThrow('Changed encounter');expect(shared.size).toBe(0);
});
