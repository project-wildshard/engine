import {expect,test} from 'vitest';
import * as v from 'valibot';
import {DecisionScriptRowDocumentSchema,DecisionScriptsSchema,type DecisionScriptRowInput} from '@wildshard/format/decisionScripts';
import {ReturnProgramDocumentSchema,ReturnProgramWireDocumentSchema} from '@wildshard/format/returnProgramDocument';
import {namedJsonSchema} from '@wildshard/engine/host/formatJsonSchema';
import {encodeCanonicalJson} from '@wildshard/engine/host/immutable';
import {validateNamedJsonSchema} from '../src/shared/game/shardfile/customSchema';

const script:DecisionScriptRowInput={id:'return.wire',abi:'1.0',side:'sim',module:`blobs/wasm/${'a'.repeat(64)}.wasm`,
 source:'behaviour/return.as',binding:{shard:true},onFail:'hold',on:['start'],reads:[],commands:[],stateVersion:1,state:[],params:{}};
const document={script,bytes:''};
const bytes=(value:unknown):Uint8Array=>new TextEncoder().encode(JSON.stringify(value));

test('wire admission preserves omitted defaults and explicit empty namespaces exactly',()=>{
 for(const input of [document,{...document,script:{...script,pages:1,tick:null,actors:{},bodies:{},colliders:{},timers:[]}}]){
  const before=JSON.stringify(input),result=v.parse(ReturnProgramWireDocumentSchema,input);
  expect(result).toEqual(input);
  expect(encodeCanonicalJson(result)).toBe(encodeCanonicalJson(input));
  expect(JSON.stringify(input)).toBe(before);
  expect(v.parse(DecisionScriptsSchema,[result.script])).toEqual(v.parse(DecisionScriptsSchema,[input.script]));
 }
 expect(v.parse(ReturnProgramDocumentSchema,document).script).toHaveProperty('tick',null);
 expect(v.parse(ReturnProgramWireDocumentSchema,document).script).not.toHaveProperty('tick');
});

test('wire structure and the unchanged full native admission refuse malformed scripts',()=>{
 for(const input of [{...script,abi:'2.0'},{...script,source:'behaviour/generated/return.as'},
  {...script,pages:5},{...script,on:['start','start']},{...script,tick:1},{...script,params:{constructor:1}},
  {...script,state:[{name:'value',type:'i32',default:0.5,scope:'binding'}]},
  {...script,fields:{'two.words':'one','twoWords':'two'}}, {...script,foreign:true},
  JSON.parse(JSON.stringify(script).replace('"params":{}','"params":{"__proto__":1}'))]){
  expect(v.safeParse(DecisionScriptsSchema,[input]).success).toBe(false);
  expect(v.safeParse(DecisionScriptRowDocumentSchema,input).success).toBe(false);
  expect(v.safeParse(ReturnProgramWireDocumentSchema,{...document,script:input}).success).toBe(false);
 }
 for(const input of [{...document,bytes:()=>''},{...document,v2:{}},{...document,foreign:true}])
  expect(v.safeParse(ReturnProgramWireDocumentSchema,input).success).toBe(false);
 let reads=0;const input={bytes:''};
 Object.defineProperty(input,'script',{enumerable:true,get:()=>{reads++;return script;}});
 expect(v.safeParse(ReturnProgramWireDocumentSchema,input).success).toBe(false);
 expect(reads).toBe(0);
});

test('output metadata validates the actual unnormalized wire and still requires every native field',()=>{
 const schema=namedJsonSchema(ReturnProgramWireDocumentSchema,{provenance:true});
 expect(schema).toMatchObject({$comment:'@wildshard/format/returnProgramDocument#ReturnProgramWireDocumentSchema',
  additionalProperties:false,properties:{script:{additionalProperties:false}}});
 expect(()=>validateNamedJsonSchema(schema,bytes(document))).not.toThrow();
 expect(()=>validateNamedJsonSchema(schema,bytes({...document,script:{id:script.id}}))).toThrow();
 expect(()=>validateNamedJsonSchema(schema,bytes({...document,script:{...script,pages:5}}))).toThrow();
 expect(()=>validateNamedJsonSchema(schema,bytes({...document,script:{...script,foreign:true}}))).toThrow();
});
