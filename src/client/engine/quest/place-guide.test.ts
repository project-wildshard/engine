import { expect, it } from 'vitest';
import { PlaceGuide } from '@wildshard/engine/quest/view';
import {onFault,type Fault} from '../../../shared/engine/core/faults';

const idle = { distance: 'edge', min: 0, schedule: { kind: 'idle', wander: 50, idle: 10, idleSpeed: 0.4, cooldown: 90, retry: 8 } };
const periodic = { distance: 'centre', min: 40, max: 450, schedule: { kind: 'periodic', initial: 25, period: [90, 150] } };
const position = (): { x: number; z: number } => ({ x: 0, z: 0 });

it('guides towards the nearest undiscovered edge, retries busy birds and restarts progress without changing flight ownership', () => {
  const points = [{ id: 'inside', x: 0, z: 0, r: 10 }, { id: 'near-centre', x: 45, z: 0, r: 1 }, { id: 'near-edge', x: 50, z: 0, r: 20 }];
  const discovered = new Set<string>(), flights: string[] = []; let free = false;
  const guide = new PlaceGuide(idle, { points: () => points, discovered: id => discovered.has(id), position,
    fly: point => { flights.push(point.id); return free; } });
  expect(guide.target()).toBe(points[2]);
  guide.update(9, 0); expect(flights).toEqual([]);
  guide.update(1, 0); expect(flights).toEqual(['near-edge']);
  free = true; guide.update(7, 0); expect(flights).toEqual(['near-edge']);
  guide.update(1, 0); expect(flights).toEqual(['near-edge', 'near-edge']);
  guide.update(89, 1); guide.progressed(); guide.update(1, 1);
  expect(flights).toEqual(['near-edge', 'near-edge']);
  guide.update(49, 1); expect(flights.at(-1)).toBe('near-edge');
  discovered.add('near-edge'); discovered.add('near-centre');
  guide.update(90, 0); expect(guide.target()).toBeNull();
  expect(flights).toHaveLength(3);
});

it('preserves periodic clock/random/eligibility order and centre bounds, and refuses malformed profiles or owners before flight', () => {
  const points = [{ id: 'inside', x: 41, z: 0, r: 50 }, { id: 'first', x: 40, z: 0, r: 1 },
    { id: 'tie', x: -40, z: 0, r: 1 }, { id: 'far', x: 451, z: 0, r: 1 }];
  let now = 0; const order: string[] = [];
  const ports = { points: () => points, discovered: () => false, position,
    time: () => { order.push('clock'); return now; },
    random: (lo: number, _hi: number) => { order.push('random'); return lo; },
    fly: (point: typeof points[number], force: boolean) => { order.push(`${point.id}:${String(force)}`); return true; } };
  const guide = new PlaceGuide(periodic, ports); expect(guide.target()).toBe(points[1]);
  order.length = 0; now = 24; guide.update(1); expect(order).toEqual(['clock']);
  order.length = 0; now = 25; guide.update(1, 0, () => { order.push('eligible'); return false; });
  expect(order).toEqual(['clock', 'clock', 'random', 'eligible']);
  order.length = 0; expect(guide.attempt(true)).toBe(points[1]); expect(order).toEqual(['first:true']);
  order.length = 0; now = 115; guide.update(1, 0, () => { order.push('eligible'); return true; });
  expect(order).toEqual(['clock', 'clock', 'random', 'eligible', 'first:false']);
  expect(() => new PlaceGuide({ ...periodic, extra: true }, ports)).toThrow();
  expect(() => new PlaceGuide({ ...periodic, max: 20 }, ports)).toThrow();
  expect(() => new PlaceGuide({ ...periodic, schedule: { kind: 'periodic', initial: 25, period: [90, 80] } }, ports)).toThrow();
  expect(() => new PlaceGuide(periodic, { points: ports.points, discovered: ports.discovered, position, fly: ports.fly })).toThrow();
  expect(() => guide.update(-1)).not.toThrow();
  const bad = new PlaceGuide(periodic, { ...ports, random: () => Infinity });
  now += 25; expect(() => bad.update(1)).not.toThrow();
  const invalid = new PlaceGuide(idle, { ...ports, points: () => [{ id: 'bad', x: Number.NaN, z: 0, r: 1 }] });
  expect(() => invalid.attempt()).toThrow();
  const unbounded = new PlaceGuide(idle, { ...ports, points: () => Array.from({ length: 4097 }, () => points[0] ?? { id: '', x: 0, z: 0, r: 0 }) });
  expect(() => unbounded.target()).toThrow();
});

it.each(['delta','clock','delay','points'])('a refused automatic guide %s reports once and a later valid frame can guide',kind=>{
  let now=0,bad=false;const flights:string[]=[],faults:Fault[]=[];
  const ports={position,discovered:()=>false,points:()=>[{id:'near',x:bad&&kind==='points'?Number.NaN:50,z:0,r:1}],
    time:()=>bad&&kind==='clock'?Number.NaN:now,random:(lo:number)=>bad&&kind==='delay'?Number.POSITIVE_INFINITY:lo,
    fly:(point:{id:string})=>{flights.push(point.id);return true;}};
  const guide=new PlaceGuide(periodic,ports),off=onFault(fault=>{faults.push(fault);});
  try{
    now=25;bad=true;
    for(let i=0;i<2;i++)expect(()=>guide.update(kind==='delta'?Number.NaN:1)).not.toThrow();
    expect(flights).toEqual([]);expect(faults).toHaveLength(1);expect(faults[0]).toMatchObject({system:'quest.guide',verdict:'retry'});
    const messages={delta:'Invalid guide step',clock:'Invalid guide clock',delay:'Invalid guide delay',points:'Invalid guide point'};
    if(kind==='delta'||kind==='clock'||kind==='delay'||kind==='points')expect(faults[0]?.error).toMatchObject({message:messages[kind]});
    bad=false;
    // The point refusal follows the accepted next-delay write; do not replay it.
    if(kind==='points')now=115;
    guide.update(1);expect(flights).toEqual(['near']);
    now+=90;guide.update(1);expect(flights).toEqual(['near','near']);
  }finally{off();}
});
