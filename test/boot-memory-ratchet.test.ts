import {expect,test} from 'vitest';
import {BufferAttribute,BufferGeometry,InstancedMesh,InterleavedBuffer,InterleavedBufferAttribute,Mesh,MeshBasicMaterial,Scene} from 'three';
import {bootMemoryVerdict,retainedGeometryBytes} from '../scripts/loading-flow/boot-memory-ratchet.mjs';

// Mini QA 2026-11-17 row 19: the Nine load's memory ratchet (ci.yml nine-ring1, blocking)
const marks=(held:number|undefined,...released:number[])=>[
  {operation:'download:members-dropped',detail:held===undefined?{count:3}:{count:3,held}},
  ...released.map(bytes=>({operation:'memory:geometry-released',detail:{after:'readyFrame',bytes}})),
];
test('early releases pass with no held parts and both memory measurements within budget',()=>{
  expect(bootMemoryVerdict(marks(0,13.8e6),53e6,309.6e6)).toEqual({held:0,released:13.8e6,retained:53e6,live:309.6e6,faults:[]});
  expect(bootMemoryVerdict(marks(0),58.3e6,340e6).faults).toEqual([]);
  expect(bootMemoryVerdict(marks(0),58.3e6+1,340e6).faults).toHaveLength(1);
});

test('held parts, high retained geometry and high live heap fail independently',()=>{
  const verdict=bootMemoryVerdict(marks(undefined,77.6e6),117e6,367e6);
  expect(verdict.faults).toEqual([
    'boot memory: no download:members-dropped mark with its held count',
    'boot memory: retained CPU geometry 117.0 MB at control, over the 58.3 MB ceiling',
    'boot memory: live heap 367 MB at control, over the 340 MB ceiling',
  ]);
  expect(bootMemoryVerdict(marks(2),53e6,300e6).faults).toEqual(['boot memory: 2 spawn parts still held past the download step']);
  expect(bootMemoryVerdict(marks(0),null,300e6).faults).toEqual(['boot memory: no retained CPU geometry measurement at control']);
  expect(bootMemoryVerdict(marks(0),53e6,Number.NaN).faults).toHaveLength(1);
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
