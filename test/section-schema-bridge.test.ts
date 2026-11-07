import {HeldEquipmentSchema} from '@wildshard/format/heldEquipment';
import * as v from 'valibot';
import {expect,it} from 'vitest';
import {sectionType} from '../scripts/section-types.mjs';

it('preserves tuple, optional and union shapes and refuses unresolved declaration types',()=>{
  expect(sectionType({type:'object',properties:{at:{type:'array',items:[{type:'number'},{type:'number'}]},mode:{enum:['a','b']}},required:['at'],additionalProperties:false}))
    .toBe('{ "at": [number, number]; "mode"?: "a" | "b"; }');
  expect(sectionType({type:'array',items:{enum:['a','b']}})).toBe('("a" | "b")[]');
  expect(sectionType({type:'array',items:{type:'array',items:{type:'number'}}})).toBe('number[][]');
  expect(()=>sectionType({$ref:'#/missing'})).toThrow('Unresolved');
  expect(()=>sectionType({pattern:'unknown'})).toThrow('Unsupported');
});

it('keeps held semantic refusals on the public platform schema',()=>{
  const program={id:'schema-case',reads:[],nodes:[{op:'constant',value:1}],channels:[{property:'x',value:0}]};
  const value=(row:unknown)=>({crossbow:[row],lever:[],crossbowParts:[],leverParts:[]});
  const schema=HeldEquipmentSchema.entries.playback;
  expect(v.parse(schema,value(program))).toEqual(value(program));
  expect(()=>v.parse(schema,value({...program,nodes:[{op:'sin',a:0}]}))).toThrow();
  expect(()=>v.parse(schema,value({...program,reads:[123]}))).toThrow();
});
