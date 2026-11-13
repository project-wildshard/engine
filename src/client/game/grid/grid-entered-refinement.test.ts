import {expect,test} from 'vitest';
import {admitsCellTiles,placeholderBlocksTiles} from './nearPlaceholderPlan';
import {ResidencyAllocator} from '../../../shared/game/grid/allocator';
import {TileStreamer,type RingPorts} from '@wildshard/engine/world/tileStreamer';

test('entered cells retain refinement independently of near views and shared registration',()=>{
  expect(placeholderBlocksTiles('plot','plot',false,false,true)).toBe(false);
  expect(placeholderBlocksTiles('plot','plot',false,true,false)).toBe(false);
  expect(placeholderBlocksTiles('nine','plot',false,false,true)).toBe(true);
  expect(placeholderBlocksTiles('near','plot',false,true,false)).toBe(true);
  expect(placeholderBlocksTiles('registered','plot',true,false,true)).toBe(false);
});

test('a no-near entered plot owns L0/L1 claims while an approached no-near neighbour keeps its proxy',()=>{
  const cells=[{instance:'plot',origin:{x:0,z:0}},{instance:'nine',origin:{x:555,z:0}}];
  const allocator=new ResidencyAllocator();let entered:string|null=null;
  const blocked=(instance:string):boolean=>placeholderBlocksTiles(instance,entered,false,false,true);
  const ports:RingPorts<string>={fetch:(tile,done)=>{done(tile.key);},upload:()=>({mask:()=>undefined,shadow:()=>undefined,dispose:()=>undefined})};
  const streamer=new TileStreamer(cells,allocator,(instance,level)=>level==='far'?1000:blocked(instance)?null:100,ports);
  const step=():void=>{
    streamer.step({x:0,z:0,vx:0,vz:0});
    for(const cell of cells)if(blocked(cell.instance))streamer.retireRefinement(cell.instance);
  };
  try{
    for(let frame=0;frame<100;frame++)step();
    expect(allocator.entries().every(row=>row.category==='far')).toBe(true);
    entered='plot';for(let frame=0;frame<100;frame++)step();
    const claims=allocator.entries();
    expect(claims.some(row=>row.owner==='plot'&&row.category==='l0')).toBe(true);
    expect(claims.some(row=>row.owner==='plot'&&row.category==='l1')).toBe(true);
    expect(claims.some(row=>row.owner==='nine'&&row.category==='far')).toBe(true);
    expect(claims.filter(row=>row.owner==='nine').every(row=>row.category==='far')).toBe(true);
    entered=null;for(let frame=0;frame<100;frame++)step();
    expect(allocator.entries().every(row=>row.category==='far')).toBe(true);
  }finally{streamer.dispose();}
  expect(allocator.entries()).toHaveLength(0);
});

test('an entered runtime whose ground is its ring tiles admits them; one that draws its own ground does not (DL17, D189)',()=>{
  expect(admitsCellTiles('nine','pine',false,false)).toBe(true);
  expect(admitsCellTiles('pine',null,false,false)).toBe(true);
  // Pine: drawn by its runtime, outside the tile registration, no cellGround: its ground is these tiles
  expect(admitsCellTiles('pine','pine',false,false)).toBe(true);
  expect(admitsCellTiles('drift','drift',true,false)).toBe(false);
  expect(admitsCellTiles('nalati','nalati',false,true)).toBe(false);
  // a drawn cell whose runtime holds the tile registration never takes a second copy (DL17), whatever its manifest says
  expect(admitsCellTiles('drift','drift',true,true)).toBe(false);
});

test('a cell the rule admits streams its L0 / L1 ground; skipped, Pine kept only its far proxy',()=>{
  const cells=[{instance:'pine',origin:{x:0,z:0}},{instance:'drift',origin:{x:0,z:-555}}];
  const allocator=new ResidencyAllocator(),offered=new Set<string>(),drawn='pine';
  // the session's catalogue: no tile until the cell's product is offered to the tile views
  const ports:RingPorts<string>={fetch:(tile,done)=>{done(tile.key);},upload:()=>({mask:()=>undefined,shadow:()=>undefined,dispose:()=>undefined})};
  const streamer=new TileStreamer(cells,allocator,(instance,level)=>level==='far'?1000:offered.has(instance)?100:null,ports);
  try{
    for(let frame=0;frame<100;frame++){
      for(const cell of cells)if(admitsCellTiles(cell.instance,drawn,false,false))offered.add(cell.instance);
      streamer.step({x:0,z:0,vx:0,vz:0});
    }
    const claims=allocator.entries().filter(row=>row.owner==='pine');
    expect(claims.some(row=>row.category==='l0')).toBe(true);
    expect(claims.some(row=>row.category==='l1')).toBe(true);
  }finally{streamer.dispose();}
});
