import {expect,test} from 'vitest';
import * as v from 'valibot';
// oxlint-disable-next-line import/no-nodejs-modules -- Pin each complete original named document.
import {createHash} from 'node:crypto';
import {PopulationProjectionSchema} from '@wildshard/format/populationProjection';
import {PerchBodyFileSchema} from '@wildshard/format/mixedPopulation';
import {registeredJsonSchema} from '../src/shared/host/formatJsonSchema';
import {platformFileFamily,validatePlatformFile} from '@wildshard/format/platformFileFamilies';
import {nameBlob} from '../src/sharddev/blobs';
import {encodeCanonicalJson} from '../src/shared/host/immutable';
import fixture from './fixtures/approved-population-returns.json' with {type:'json'};

for(const [name,schema,source] of [
 ['actors/projection.json',PopulationProjectionSchema,'@wildshard/format/populationProjection#PopulationProjectionSchema'],
 ['poses/monkey.json',PerchBodyFileSchema,'@wildshard/format/mixedPopulation#PerchBodyFileSchema'],
] as const)test(`the complete ${name} retains native, decoded and canonical wire identity`,()=>{
 const original=fixture[name],input:unknown=JSON.parse(original.body),before=JSON.stringify(input),result=v.parse(schema,input);
 expect(createHash('sha256').update(original.body).digest('hex')).toBe(original.sha256);
 expect(result).toEqual(input);expect(encodeCanonicalJson(result)).toBe(original.body);
 const document=registeredJsonSchema(name),family=platformFileFamily(name,source);
 if(document===undefined||family===undefined)throw new Error('Missing complete population contract');
 expect(validatePlatformFile(name,source,input)).toBe(family);
 expect(nameBlob(name,'json',new TextEncoder().encode(original.body),{jsonSchema:document}).bytes).toEqual(new TextEncoder().encode(original.body));
 expect(platformFileFamily(name,`${source}Other`)).toBeUndefined();
 expect(platformFileFamily(`private/${name}`,source)).toBeUndefined();
 expect(()=>validatePlatformFile(name,source,{...result,foreign:true})).toThrow();
 expect(JSON.stringify(input)).toBe(before);
});

test('projection and perch reject partial native guests without touching the general body binding',()=>{
 const projection=v.parse(PopulationProjectionSchema,JSON.parse(fixture['actors/projection.json'].body));
 for(const program of [{...projection.practice.program,script:null},{...projection.practice.program,bytes:1},
  {...projection.practice.program,signal:'not-in-the-original-envelope'}])
  expect(()=>v.parse(PopulationProjectionSchema,{...projection,practice:{...projection.practice,program}})).toThrow();
 const perch=v.parse(PerchBodyFileSchema,JSON.parse(fixture['poses/monkey.json'].body));
 expect(()=>v.parse(PerchBodyFileSchema,{...perch,clips:[]})).toThrow();
 expect(()=>v.parse(PerchBodyFileSchema,{...perch,program:{...perch.program,script:{}}})).toThrow();
 expect(()=>v.parse(PerchBodyFileSchema,{...perch,perch:{...perch.perch,root:{}}})).toThrow();
});
