import { expect,test } from 'vitest';
import type { NpcDef } from '../src/shared/engine/quest/core';
import { DialogueClock,NpcDialogue } from '../src/shared/engine/quest/dialogueClock';

test('old reading resumes on the same clock, completes once, and refuses corrupt continuation before flags',()=>{
  const values=new Set(['ready']);let grants=0;
  const flags={has:(flag:string)=>values.has(flag),set:(flag:string)=>{values.add(flag);grants++;}};
  const npc:NpcDef={id:'guide',name:'Guide',dialogue:[{when:{all:['ready']},lines:['Find the key.','Return to the gate.'],sets:['talked:guide']}]};
  const original=new NpcDialogue(npc,flags);expect(original.open()).toBe(true);original.update(0.05);
  const old=original.snapshot();const clock=new DialogueClock(),resumed=new NpcDialogue(npc,flags,clock);
  resumed.restore(old);expect(resumed.clock).toBe(clock);expect(clock.text).toBe(original.clock.text);
  expect(()=>resumed.finish()).toThrow();expect(grants).toBe(0);
  const before=clock.snapshot();
  expect(()=>resumed.restore({...old,npc:'foreign'})).toThrow();expect(clock.snapshot()).toEqual(before);expect(grants).toBe(0);
  expect(()=>resumed.restore({...old,entry:99})).toThrow();expect(clock.snapshot()).toEqual(before);
  for(let i=0;i<8&&clock.isOpen;i++)resumed.advance();
  expect(clock.isOpen).toBe(false);expect(values.has('talked:guide')).toBe(true);expect(grants).toBe(1);
  resumed.advance();expect(grants).toBe(1);
  values.delete('talked:guide');const cancelled=new NpcDialogue(npc,flags);cancelled.open();cancelled.cancel();
  expect(cancelled.clock.isOpen).toBe(false);expect(values.has('talked:guide')).toBe(false);
  // The page opens its existing panel clock after selecting the same authored entry.
  const pageClock=new DialogueClock(),page=new NpcDialogue(npc,flags,pageClock),entry=page.select();
  if(entry===null)throw new Error('Missing authored reading');pageClock.open(entry.lines);
  for(let i=0;i<8&&pageClock.isOpen;i++)pageClock.advance();pageClock.close();page.finish();
  expect(values.has('talked:guide')).toBe(true);
});
