import {expect,test} from 'vitest';
import {bootMemoryVerdict} from '../scripts/loading-flow/boot-memory-ratchet.mjs';

// Mini QA 2026-11-17 row 19: the Nine load's memory ratchet (ci.yml nine-ring1, blocking)
const marks=(held:number|undefined,...released:number[])=>[
  {operation:'download:members-dropped',detail:held===undefined?{count:3}:{count:3,held}},
  ...released.map(bytes=>({operation:'memory:geometry-released',detail:{after:'readyFrame',bytes}})),
];
const limits={releasedFloor:60e6,liveCeiling:400e6};

test('a boot that holds no parts, releases its drawn geometry and stays under the ceiling passes',()=>{
  expect(bootMemoryVerdict(marks(0,12e6,64e6),300e6,limits)).toEqual({held:0,released:76e6,live:300e6,faults:[]});
});

test('the boot before the cuts fails each check',()=>{
  const verdict=bootMemoryVerdict(marks(undefined),450e6,limits);
  expect(verdict.faults).toEqual([
    'boot memory: no download:members-dropped mark with its held count',
    'boot memory: released 0.0 MB of drawn geometry, under the 60 MB floor',
    'boot memory: live heap 450 MB at control, over the 400 MB ceiling',
  ]);
  expect(bootMemoryVerdict(marks(2,70e6),300e6,limits).faults).toEqual(['boot memory: 2 spawn parts still held past the download step']);
  expect(bootMemoryVerdict(marks(0,70e6),Number.NaN,limits).faults).toHaveLength(1);
});
