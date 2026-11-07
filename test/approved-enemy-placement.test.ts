import {expect,test} from 'vitest';
import * as v from 'valibot';
// oxlint-disable-next-line import/no-nodejs-modules -- Pin the original complete file's wire bytes.
import {createHash} from 'node:crypto';
import {EnemyPlacementsSchema} from '@wildshard/format/populationProjection';
import {platformFileFamily,validatePlatformFile} from '@wildshard/format/platformFileFamilies';
import {registeredJsonSchema} from '../src/shared/host/formatJsonSchema';
import {nameBlob} from '../src/sharddev/blobs';
import {encodeCanonicalJson} from '../src/shared/host/immutable';
import {EnemyPlacementsSchema as originalPlacement} from './fixtures/driftwoodLegacySections';
import fixture from './fixtures/approved-enemy-placement.json' with {type:'json'};

const name='sim/enemy-placement.json',source='@wildshard/format/populationProjection#EnemyPlacementsSchema';
test('approved enemy placement retains the entire original page/native file and exact wire bytes',()=>{
 const input:unknown=JSON.parse(fixture.body),before=JSON.stringify(input),document=registeredJsonSchema(name);
 if(document===undefined)throw new Error('Missing complete enemy placement contract');
 const family=platformFileFamily(name,source);
 if(family===undefined)throw new Error('Missing exact enemy placement family');
 expect(createHash('sha256').update(fixture.body).digest('hex')).toBe(fixture.sha256);
 expect(new TextEncoder().encode(fixture.body)).toHaveLength(8572);
 expect(v.parse(EnemyPlacementsSchema,input)).toEqual(input);
 expect(encodeCanonicalJson(v.parse(originalPlacement,input))).toBe(fixture.body);
 expect(encodeCanonicalJson(v.parse(EnemyPlacementsSchema,input))).toBe(fixture.body);
 expect(validatePlatformFile(name,source,input)).toBe(family);
 expect(nameBlob(name,'json',new TextEncoder().encode(fixture.body),{jsonSchema:document}).bytes).toEqual(new TextEncoder().encode(fixture.body));
 expect(platformFileFamily(name,undefined)).toBeUndefined();
 expect(platformFileFamily(name,`${source}Other`)).toBeUndefined();
 expect(platformFileFamily(`private/${name}`,source)).toBeUndefined();
 expect(JSON.stringify(input)).toBe(before);
});
test('complete enemy placement retains native RNG, population, kind and root refusals',()=>{
 const input=v.parse(EnemyPlacementsSchema,JSON.parse(fixture.body));
 const enemy=input.native.enemies[0];if(enemy===undefined)throw new Error('Missing original native enemy');
 for(const bad of [
  {...input,foreign:true},
  {...input,seed:-1},
  {...input,native:{...input.native,herds:-1}},
  {...input,native:{...input.native,stream:{...input.native.stream,version:2}}},
  {...input,page:{...input.page,phone:{...input.page.phone,kinds:['foreign']}}},
  {...input,page:{...input.page,desktop:{...input.page.desktop,enemies:Array.from({length:65},()=>enemy)}}},
 ]){
  expect(()=>v.parse(originalPlacement,bad)).toThrow();
  expect(()=>validatePlatformFile(name,source,bad)).toThrow();
 }
});
