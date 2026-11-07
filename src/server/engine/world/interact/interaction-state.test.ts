import { expect,test } from 'vitest';
import { Flags,bindInteractionState,bindInteractionTransitions } from '../../../../shared/engine/world/interact/flags';

test('read-only row state keeps locks, pickup visibility, loot order and live door reach',()=>{
  const flags=new Flags('interaction-state-fixture',false);
  const at={poi:'world' as const,x:0,z:0};
  const chest=bindInteractionState({kind:'chest',id:'chest',at,lock:'hold',requires:{all:['ready']},lockedLabel:'Bring the key',reach:4,
    contents:[{item:'resin',n:2},{key:'gate',label:'Gate key'},{flag:'found:map',label:'Map'}]},flags);
  expect(chest.locked()).toBe('Bring the key');flags.set('ready');expect(chest.locked()).toBe('Bring the key');
  flags.set('key:hold');expect(chest.locked()).toBeNull();expect(chest.promptRadius()).toBe(4);
  expect(chest.contents.map(row=>row.id)).toEqual(['resin','key:gate','found:map']);
  flags.set(chest.open);expect(chest.promptRadius()).toBe(0);
  const pickup=bindInteractionState({kind:'pickup',id:'pickup',at,look:'token',label:'Token',showWhen:{all:['ready']}},flags);
  expect(pickup.shown()).toBe(true);flags.set(pickup.taken);expect(pickup.shown()).toBe(false);expect(pickup.promptRadius()).toBe(0);
  const door=bindInteractionState({kind:'door',id:'door',at,look:'grate',w:2,h:3,reach:4,requires:{all:['ready']}},flags);
  expect(door.promptRadius()).toBe(4);expect(door.promptRadius(1)).toBe(0);expect(door.promptRadius(0,false)).toBe(0);
  const lever=bindInteractionState({kind:'lever',id:'lever',at,latch:true},flags);
  expect(lever.promptRadius()).toBeGreaterThan(0);flags.set(lever.lever);expect(lever.promptRadius()).toBe(0);
  let writes=0;const off=flags.onChange(()=>{writes++;});
  chest.shown();chest.locked();door.promptRadius();expect(writes).toBe(0);off();
  expect(()=>bindInteractionState({kind:'bench',id:'bad',at,label:'Bad',reach:Infinity},flags)).toThrow();
  expect(()=>bindInteractionState({kind:'bench',id:'',at,label:'Bad'},flags)).toThrow();
});


test('native table transitions retain grants, toggle/release/latch order and refuse before effects',()=>{
  const values=new Set<string>(),events:string[]=[];
  const flags={has:(id:string)=>values.has(id),set:(id:string,on=true)=>{events.push(`${id}:${on}`);if(on)values.add(id);else values.delete(id);}};
  const at={poi:'world' as const,x:0,z:0};
  const chest=bindInteractionState({kind:'chest',id:'cache',at,requires:{all:['ready']},contents:[{item:'resin',n:2},{key:'gate',label:'Gate'},{item:'coin'}]},flags);
  const plank=bindInteractionState({kind:'door',id:'hut',at,look:'plank',w:2,h:3},flags);
  const manual=bindInteractionState({kind:'door',id:'manual',at,look:'grate',w:2,h:3,latch:true},flags);
  const plate=bindInteractionState({kind:'plate',id:'floor',at,size:2,by:'player',sets:['pressed']},flags);
  const gate=bindInteractionState({kind:'door',id:'sluice',at,look:'sluice',w:2,h:3,latch:true,opensWhen:{all:['pressed']}},flags);
  const resin=bindInteractionState({kind:'pickup',id:'resin',at,look:'resin',label:'Resin',item:'resin',touch:true,sets:['found'],showWhen:{all:['ready']}},flags);
  let pressed=false,touched=false;
  const rows=[chest,plank,manual,plate,gate,resin];
  const ports={commit:(id:string)=>{if(id==='cache'&&flags.has(chest.open))return{ok:false};events.push(`run:${id}`);if(id==='cache')flags.set(chest.open);return{ok:true};},
    item:(id:string,n:number)=>{events.push(`item:${id}:${n}`);},plate:()=>pressed,touched:()=>touched};
  const table=bindInteractionTransitions(rows,flags,ports);
  expect(table.interact(chest)).toBe(false);expect(events).toEqual([]);
  flags.set('ready');events.length=0;expect(table.interact(chest)).toBe(true);
  expect(events).toEqual(['run:cache','open:cache:true','item:resin:2','key:gate:true','item:coin:1']);
  events.length=0;expect(table.interact(chest)).toBe(false);expect(events).toEqual([]);
  table.interact(plank);expect(flags.has(plank.open)).toBe(true);table.interact(plank);expect(flags.has(plank.open)).toBe(false);
  pressed=true;events.length=0;table.step([plate,gate]);expect(events).toEqual(['plate:floor:true','pressed:true','open:sluice:true']);
  pressed=false;events.length=0;table.step([plate,gate,manual]);expect(events).toEqual(['plate:floor:false','pressed:false']);
  expect(flags.has(gate.open)).toBe(true);expect(flags.has(manual.open)).toBe(false);
  events.length=0;table.step([resin]);expect(events).toEqual([]);touched=true;table.step([resin]);expect(events).toEqual(['run:resin']);
  const direct=bindInteractionTransitions([resin],flags,{...ports,touch:'direct'});events.length=0;direct.step();
  expect(events).toEqual(['taken:resin:true','found:true','item:resin:1']);events.length=0;direct.step();expect(events).toEqual([]);
  const foreign=bindInteractionState({kind:'bench',id:'foreign',at,label:'Elsewhere'},flags);
  expect(()=>table.step([plate,foreign])).toThrow();expect(events).toEqual([]);
  expect(()=>table.interact(foreign)).toThrow();expect(()=>table.setFlags(['good',''])).toThrow();expect(flags.has('good')).toBe(false);
  expect(()=>bindInteractionTransitions([resin,resin],flags,ports)).toThrow();
  expect(()=>bindInteractionTransitions([plate],flags,{commit:ports.commit,item:ports.item})).toThrow();
  expect(()=>bindInteractionTransitions([resin],flags,{commit:ports.commit,item:ports.item})).toThrow();
  expect(()=>bindInteractionTransitions([chest],flags,{...ports,rowLimit:Infinity})).toThrow();
  expect(()=>bindInteractionTransitions([{...chest,contents:[{kind:'item',id:'bad',n:Number.NaN}]}],flags,ports)).toThrow();
  expect(events).toEqual([]);
});
