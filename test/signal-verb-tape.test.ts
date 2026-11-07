// @vitest-environment node
import {expect,test} from 'vitest';
import * as v from 'valibot';
import {openProductSession} from './fixtures/headless/productSession';
import type {HeadlessTapeSegment} from '../src/shared/host/headlessTape';

const marksSchema=v.object({version:v.literal(1),marks:v.record(v.string(),v.boolean())});
const walk=(id:string,points:[number,number][]):HeadlessTapeSegment=>({id,ticks:5000,commands:[],route:points.map(([x,z])=>({x,z}))});

test('Signal walks every listed prompt and lights the tower through real oil and timed lash owners',async()=>{
  const f=await openProductSession('sunscar-dunes');
  try{
    const declared=f.product.shardfile.questHost;
    if(declared===undefined||declared===null)throw new Error('Missing admitted Signal quest host');
    const action=(id:string)=>{
      const row=declared.interactions.rows.find(entry=>entry.id===id);
      if(row===undefined)throw new Error(`Missing actual Signal interaction ${id}`);return row.act;
    };
    const use=(id:string,row:string,ticks=1):HeadlessTapeSegment=>({id,ticks,commands:[{kind:'script',actorId:declared.graph.actor,value:action(row)}]});
    const report=await f.sim.verbTape({version:1,observe:[declared.graph.step],segments:[
      use('logbook-out-of-reach','logbook'),
      walk('walk-to-sefa',[[0,70],[6,73]]),use('talk-to-sefa','talk'),
      walk('walk-to-logbook',[[-20,65],[-60,45],[-76.97,31.4]]),use('read-logbook','logbook'),
      walk('walk-to-well',[[-60,35],[-20,20],[20,10],[60,0],[81.5,-6]]),use('unraised-bucket','well'),
      use('start-heavy-crack','crank'),{id:'first-lash',ticks:10,commands:[]},{id:'second-lash',ticks:49,commands:[]},
      use('take-oil','well'),use('take-oil-again','well'),
      walk('walk-to-waymark-0',[[75,-15],[58,-32.3]]),use('unoiled-crack','light.0',60),use('pour-0','pour.0'),use('light-0','light.0',60),
      walk('walk-to-waymark-1',[[20,-15],[-20,-12],[-44,-20.3]]),use('pour-1','pour.1'),use('light-1','light.1',60),
      walk('walk-to-waymark-2',[[-20,-40],[0,-65],[34,-100.2]]),use('pour-2','pour.2'),use('light-2','light.2',60),
      walk('climb-to-signal',[[34,-80],[20,-57],[8.75,-57],[8.75,-74.5]]),use('signal-fire','fire'),use('signal-fire-again','fire'),
    ]});
    const at=(id:string)=>{const row=report.observations.find(entry=>entry.id===id);if(row===undefined)throw new Error(`Missing actual observation ${id}`);return row;};
    const mark=(id:string,key:string)=>{
      const row=at(id).adapters[0];if(row===undefined)throw new Error('Missing actual interaction continuation');
      return v.parse(marksSchema,JSON.parse(row.state)).marks[key];
    };
    const current=(id:string)=>at(id).quests.find(row=>row.id==='sunscar.signal')?.currentId;
    expect(at('logbook-out-of-reach').flags).not.toContain('sunscar.logbook');
    expect(at('talk-to-sefa').flags).toContain('sunscar.scout');expect(current('talk-to-sefa')).toBe('logbook');
    expect(at('read-logbook').flags).toContain('sunscar.logbook');expect(current('read-logbook')).toBe('oil');
    expect(at('unraised-bucket').flags).not.toContain('sunscar.oil');
    expect(mark('start-heavy-crack','raised')).toBe(false);expect(mark('first-lash','raised')).toBe(false);
    expect(mark('second-lash','raised')).toBe(true);
    expect(at('take-oil').flags).toContain('sunscar.oil');expect(current('take-oil')).toBe('waymarks');
    expect(at('take-oil-again').flags).toEqual(at('take-oil').flags);
    expect(mark('unoiled-crack','lit.0')).toBe(false);
    for(const i of [0,1,2]){
      expect(mark(`pour-${i}`,`oiled.${i}`)).toBe(true);expect(mark(`pour-${i}`,`lit.${i}`)).toBe(false);
      expect(at(`light-${i}`).flags).toContain(`sunscar.brazier.${i}`);expect(mark(`light-${i}`,`lit.${i}`)).toBe(true);
    }
    expect(current('light-2')).toBe('fire');expect(at('climb-to-signal').flags).not.toContain('sunscar.lit');
    expect(at('signal-fire').flags).toContain('sunscar.lit');expect(current('signal-fire')).toBe('matriarch');
    expect(at('signal-fire').quests.find(row=>row.id==='sunscar.signal')?.complete).toBe(false);
    expect(at('signal-fire-again').effects).toEqual([]);expect(at('signal-fire-again').flags).toEqual(at('signal-fire').flags);
    expect(f.sim.quarantined).toBe(false);
  }finally{await f.sim.dispose();}
},30_000);
