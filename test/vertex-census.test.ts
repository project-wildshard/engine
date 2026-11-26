import {expect,test} from 'vitest';
import {familyOf,heaviestPasses,liveVaryings,preprocess,programName,residentCensus} from '../src/scripts/memory/vertex-census.mjs';

test('the preprocessor keeps the live branch of #if, #ifdef and defined()',()=>{
  const src=['#define USE_UV','#define NUM_LIGHTS 2','#ifdef USE_UV','a','#else','b','#endif','#if NUM_LIGHTS > 0 && defined( USE_UV )','c','#elif 1','d','#endif','#ifndef USE_UV','e','#endif'].join('\n');
  expect(preprocess(src).lines).toEqual(['a','c']);
});

test('live varyings: vertex outputs the fragment stage reads, after the preprocessor; arrays and matrices count components',()=>{
  const vs='#version 300 es\n#define varying out\n#define USE_FOG\nvarying vec2 vUv;\nout highp vec3 vNormal;\nflat out float vId[2];\n#ifdef USE_FOG\nvarying float vFog;\n#endif\n#ifdef USE_NOPE\nvarying vec4 vGone;\n#endif\nvarying vec4 vUnused;\nin vec3 position;\nvoid main(){}';
  const fs='#version 300 es\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\nvarying vec2 vUv;\nin vec3 vNormal;\nflat in float vId[2];\nvarying float vFog;\nvoid main(){}';
  expect(liveVaryings(vs,fs)).toEqual({count:4,components:8,names:['vFog','vId','vNormal','vUv'],vertexOutputs:5});
});

test('a program is named by SHADER_NAME, then three SHADER_TYPE, then its id',()=>{
  expect(programName('#define SHADER_NAME graph:material:slab\n',3)).toBe('graph:material:slab');
  expect(programName('#define SHADER_TYPE MeshStandardMaterial\n',3)).toBe('three:MeshStandardMaterial');
  expect(programName('void main(){}',7)).toBe('program #7');
  expect(familyOf(['graph:material:nine-architecture'])).toBe('graph:material:nine-architecture');
  expect(familyOf(['terrain-chunk #2'])).toBe('terrain');
  expect(familyOf([])).toBe('unread');
});

test('resident vertices count each vertex buffer once, by its stride; instance, index and unlaid bytes stand apart',()=>{
  const at=(name:string,size:number,type:number,stride:number,offset:number,divisor=0)=>({name,size,type,normalized:false,int:false,stride,offset,divisor});
  const r=residentCensus([
    {id:1,bytes:1200,target:0x8892,layout:[at('position',3,0x1406,12,0)],programs:[1]},
    {id:2,bytes:400,target:0x8892,layout:[at('normal',4,0x1400,4,0)],programs:[1]},
    {id:3,bytes:640,target:0x8892,layout:[at('position',4,0x1402,16,0),at('aMisc',2,0x140b,16,8)],programs:[2]},
    {id:4,bytes:6400,target:0x8892,layout:[at('instanceMatrix',4,0x1406,64,0,1)],programs:[1]},
    {id:5,bytes:300,target:0x8893,layout:[],programs:[1]},
    {id:6,bytes:99,target:0x8892,layout:[],programs:[]},
  ],new Map([[1,'three:MeshStandardMaterial'],[2,'graph:slab']]));
  expect(r).toMatchObject({arrayBytes:8739,elementBytes:300,instanceBytes:6400,unlaidBytes:99,vertexBytes:2240,vertices:140});
  expect(r.channels['position']?.bytes).toBe(100*12+40*8);
  expect(r.channels['aMisc']?.perVertex).toEqual({f16x2:40});
  expect(r.families['slab']).toMatchObject({bytes:640,vertices:40,vertexBytes:16});
});

test('the heaviest pass weighs vertex invocations by varying components plus the position',()=>{
  const info=new Map([[1,{name:'a',varyings:{count:2,components:4,names:[],vertexOutputs:2}}],[2,{name:'b',varyings:{count:10,components:30,names:[],vertexOutputs:10}}]]);
  const top=heaviestPasses({programs:[{id:1,draws:1,invocations:1000,triangles:300},{id:2,draws:1,invocations:300,triangles:100}]},info,1);
  expect(top).toEqual([{id:2,draws:1,invocations:300,triangles:100,name:'b',varyings:10,components:30,weight:300*34}]);
});
