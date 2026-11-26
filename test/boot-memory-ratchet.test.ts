import {expect,test} from 'vitest';
import {BufferAttribute,BufferGeometry,InstancedMesh,InterleavedBuffer,InterleavedBufferAttribute,Mesh,MeshBasicMaterial,Scene} from 'three';
import {bootMemoryVerdict,retainedGeometryBytes} from '../src/scripts/loading-flow/boot-memory-ratchet.mjs';

import {readCaps} from '../src/scripts/budgets/files.mjs';

// Mini QA 2026-11-17 row 19: the Nine load's memory ratchet (ci.yml nine-ring1). BUDGET-CAPS BC11: held parts and a
// missing measurement fail the load; retained geometry and the live heap go through the verdict against Nine's own
// baseline, and a regression is a fix row in the budgets job (J444), never a red ci.
const marks=(held:number|undefined,...released:number[])=>[
  {operation:'download:members-dropped',detail:held===undefined?{count:3}:{count:3,held}},
  ...released.map(bytes=>({operation:'memory:geometry-released',detail:{after:'readyFrame',bytes}})),
];
const judging=(contentKey='nine-dragon-stack@3')=>({contentKey,budgets:{caps:readCaps(),baselines:{schema:1,about:'',baselines:{
  'nine/boot/retained-geometry':{value:53e6,contentKey:'nine-dragon-stack@3'},'nine/boot/live-heap':{value:289.5e6,contentKey:'nine-dragon-stack@3'}}}}});
const statuses=(verdict:ReturnType<typeof bootMemoryVerdict>)=>verdict.rows.map(row=>row.status);

test('early releases pass with no held parts and both memory measurements within budget',()=>{
  const verdict=bootMemoryVerdict(marks(0,13.8e6),53e6,309.6e6,judging());
  expect(verdict).toMatchObject({held:0,released:13.8e6,retained:53e6,live:309.6e6,faults:[]});
  expect(statuses(verdict)).toEqual(['ok','ok']);
  expect(verdict.rows.map(row=>row.key)).toEqual(['nine/boot/retained-geometry','nine/boot/live-heap']);
  // the soft line is the baseline plus 10%: 58.3 MB of retained geometry is a regression, still no ci fault
  const regressed=bootMemoryVerdict(marks(0),58.3e6,300e6,judging());
  expect(statuses(regressed)).toEqual(['regressed','ok']);
  expect(regressed.faults).toEqual([]);
});

test('held parts or a missing measurement fail the load; high geometry is reported and high heap needs confirmation',()=>{
  const verdict=bootMemoryVerdict(marks(undefined,77.6e6),117e6,367e6,judging());
  expect(verdict.faults).toEqual(['boot memory: no download:members-dropped mark with its held count']);
  expect(statuses(verdict)).toEqual(['regressed','confirm']);
  expect(bootMemoryVerdict(marks(2),53e6,300e6,judging()).faults).toEqual(['boot memory: 2 spawn parts still held past the download step']);
  expect(bootMemoryVerdict(marks(0),null,300e6,judging()).faults).toEqual(['boot memory: no retained CPU geometry measurement at control']);
  expect(bootMemoryVerdict(marks(0),53e6,Number.NaN,judging()).faults).toEqual(['boot memory: no live heap measurement at control']);
  // the 5 MB memory floor: hosted retained geometry moves ~2 MB with upload timing (13.3 -> 15.25 MB, QA 2026-11-19 row 4)
  const hosted={contentKey:'nine-dragon-stack@3',budgets:{caps:readCaps(),baselines:{schema:1,about:'',baselines:{
    'nine/boot/retained-geometry':{value:13_309_155,contentKey:'nine-dragon-stack@3'},'nine/boot/live-heap':{value:216_970_560,contentKey:'nine-dragon-stack@3'}}}}};
  expect(statuses(bootMemoryVerdict(marks(0),15_249_927,216_259_359,hosted))).toEqual(['ok','ok']);
  expect(statuses(bootMemoryVerdict(marks(0),18_309_155,216_259_359,hosted))).toEqual(['regressed','ok']);
  // a new Nine revision is new content: only the hard cap (none on record, D3) is checked
  expect(statuses(bootMemoryVerdict(marks(0),117e6,367e6,judging('nine-dragon-stack@4')))).toEqual(['raised','raised']);
});

test('the scene census counts complete shared backing stores without restoring released arrays',()=>{
  const scene=new Scene(), geometry=new BufferGeometry(), material=new MeshBasicMaterial();
  expect(retainedGeometryBytes(scene)).toBeNull();
  const shared=new ArrayBuffer(128);
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(shared,0,6),3));
  geometry.setAttribute('uv',new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(shared,24,4),2),2,0));
  geometry.setIndex(new BufferAttribute(new Uint16Array(shared,40,3),1));
  geometry.morphAttributes.position=[new BufferAttribute(new Float32Array(3),3)];
  const released=new BufferAttribute(new Float32Array(3),3);
  Object.defineProperty(released,'array',{get:()=>{throw new Error('must never read a released array');}});
  geometry.setAttribute('normal',released);
  const instances=new InstancedMesh(geometry,material,1);
  scene.add(new Mesh(geometry,material),instances);
  expect(retainedGeometryBytes(scene)).toBe(shared.byteLength+12+instances.instanceMatrix.array.buffer.byteLength);
});
