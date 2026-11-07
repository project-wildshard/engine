import {expect,test} from 'vitest';
import {compileScriptV2} from '../src/sharddev/bake/compileScriptV2';
import {v2CoreSource} from '../src/sharddev/as/wsV2';
import {ReturnProjectionV2} from '../src/shared/game/population/returnProjectionV2';
import {returnProjectionV2Layout} from '@wildshard/format/returnProjectionV2';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {SCRIPT_V2_REVISIONS} from '@wildshard/format/scriptAdmissionV2';

test('admitted project radial math is finite and close to native geometry',async()=>{
  const layout=returnProjectionV2Layout(2);
  const bytes=await compileScriptV2(`import * as core from './core';
    export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{
      core.beginState();assert(core.beginBinding(0));const radius=core.field(0),yaw=core.field(1);
      core.pageOutput(1,core.radialX(yaw,radius));core.pageOutput(2,core.radialZ(yaw,radius));
      core.endBinding();return fuel;
    }`,{lane:'project',ioBytes:layout.bytes,sources:{'core.ts':v2CoreSource(0)}});
  const program=new ReturnProjectionV2({artifact:{abi:2,minor:0,compilerRevision:SCRIPT_V2_REVISIONS.compiler,admissionRevision:SCRIPT_V2_REVISIONS.admission,
    hash:hashImmutableBytes(bytes),lane:'project',pages:1,ioBytes:layout.bytes},fields:['radius','yaw'],signals:['radial'],channels:['x','z'],
    bytes:btoa(Array.from(bytes,byte=>String.fromCodePoint(byte)).join(''))});
  for(const yaw of [0,-0,Math.PI,-Math.PI,Math.PI/2,600*2.6,-75.8695,-74.7565,-70.3045,1e6,1e12])for(const radius of [0,1,3.6,10000]){
    const actual=program.project('radial',{radius,yaw}),expected={x:Math.sin(yaw)*radius,z:Math.cos(yaw)*radius};
    // G415: AS and native libm may round a transcendental result differently.
    // Geometry uses a tight relative/near-zero tolerance, not bit identity.
    for(const key of ['x','z'] as const)expect(Math.abs((actual[key]??Infinity)-expected[key])).toBeLessThanOrEqual(1e-12*Math.max(1,Math.abs(expected[key])));
  }
  expect(Object.is(program.project('radial',{radius:1,yaw:-0})['x'],-0)).toBe(true);
});
