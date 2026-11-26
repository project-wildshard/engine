import {expect,test} from 'vitest';
import {BufferAttribute,BufferGeometry,Group,InstancedMesh,InterleavedBuffer,InterleavedBufferAttribute,Mesh,MeshBasicMaterial,Scene} from 'three';
import {bootMemoryVerdict,releaseDrawnThenRead,retainedGeometryBytes,retainedGeometryOwners} from '../src/scripts/loading-flow/boot-memory-ratchet.mjs';

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
  // QA 11-25 row 122: the settled read (drawn copies let go first) no longer moves with upload timing, so retained
  // geometry has its own 1.5 MB floor (the deck's tile backing, a hidden prop skipped by the warm draws): growing back the 3 MB row 102
  // recorded is a regression, the deck's swap is not
  const hosted={contentKey:'nine-dragon-stack@3',budgets:{caps:readCaps(),baselines:{schema:1,about:'',baselines:{
    'nine/boot/retained-geometry':{value:6_820_000,contentKey:'nine-dragon-stack@3'},'nine/boot/live-heap':{value:216_970_560,contentKey:'nine-dragon-stack@3'}}}}};
  expect(statuses(bootMemoryVerdict(marks(0),6_060_000,216_259_359,hosted))).toEqual(['ok','ok']);
  expect(statuses(bootMemoryVerdict(marks(0),7_720_000,216_259_359,hosted))).toEqual(['ok','ok']);
  expect(statuses(bootMemoryVerdict(marks(0),9_820_000,216_259_359,hosted))).toEqual(['regressed','ok']);
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

// QA 11-25 row 122: hosted SwiftShader draws a frame every few seconds, so a read 3 s after control caught the
// after-control build's CPU copies still waiting on play's 240 renders (12.06 to 15.38 MB across one run's boots,
// retained plus released constant). The read lets every drawn, unchanged copy go first, so it measures what play keeps.
test('the boot read lets drawn copies go first, then counts only what play keeps',()=>{
  const scene=new Scene(), material=new MeshBasicMaterial();
  const drawn=new BufferGeometry(), held=new BufferGeometry();
  drawn.setAttribute('normal',new BufferAttribute(new Float32Array(300),3));
  held.setAttribute('normal',new BufferAttribute(new Float32Array(30),3));
  scene.add(new Mesh(drawn,material),new Mesh(held,material));
  const release=()=>{
    const attribute=drawn.getAttribute('normal'), bytes=(attribute.array as Float32Array).byteLength;
    Object.defineProperty(attribute,'array',{configurable:true,get:()=>{throw new Error('must never read a released array');}});
    return bytes;
  };
  const host=globalThis as {window?:unknown};
  const before=host.window;
  try {
    host.window={__wildshard:{world:{game:{rootScene:scene}}}};
    // a build whose probe has no release gives no read, never a timing-dependent one
    expect(releaseDrawnThenRead()).toBeNull();
    host.window={__wildshard:{world:{game:{rootScene:scene,frameCount:42}},releaseDrawn:release}};
    expect(releaseDrawnThenRead()).toEqual({released:1200,retained:120,frames:42});
    expect(retainedGeometryBytes(scene)).toBe(120);
  } finally {host.window=before;}
});

// QA 11-25 row 150: a moved read names who holds it. Owners are the first two named ancestors under the scene, a hidden
// subtree (never drawn, so never let go) is marked, and a backing store shared by two owners counts once.
test('the retained geometry reads by owner, largest first, hidden subtrees marked, shared stores once',()=>{
  const scene=new Scene(), material=new MeshBasicMaterial();
  const shard=new Group(); shard.name='nine-dragon-stack';
  const fabric=new Group(); fabric.name='fabric';
  const booth=new Group(); booth.name='set:booth'; booth.visible=false;
  const big=new BufferGeometry(), small=new BufferGeometry(), shared=new Float32Array(30);
  big.setAttribute('position',new BufferAttribute(new Float32Array(300),3));
  small.setAttribute('position',new BufferAttribute(new Float32Array(60),3));
  small.setAttribute('normal',new BufferAttribute(shared,3));
  const twin=new BufferGeometry(); twin.setAttribute('normal',new BufferAttribute(shared,3));
  fabric.add(new Mesh(big,material)); booth.add(new Mesh(small,material)); fabric.add(new Mesh(twin,material));
  shard.add(fabric,booth); scene.add(shard);
  const host=globalThis as {window?:unknown};
  const before=host.window;
  try {
    host.window={__wildshard:{world:{game:{rootScene:scene}}}};
    expect(retainedGeometryOwners()).toEqual([['nine-dragon-stack / fabric',1200+120],['nine-dragon-stack / set:booth [hidden]',240]]);
  } finally {host.window=before;}
});
