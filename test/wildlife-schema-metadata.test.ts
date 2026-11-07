import {expect,test} from 'vitest';
import * as v from 'valibot';
import {registeredJsonSchema,namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {ReturnProgramSchema} from '@wildshard/format/namedJsonContracts';
import {ReturnProjectionV2Schema} from '@wildshard/format/returnProjectionV2';
import {WildlifePopulationSchema} from '@wildshard/format/wildlifePopulation';
import {validateNamedJsonSchema} from '../src/shared/game/shardfile/customSchema';
import roots from './fixtures/approved-population-families.json' with {type:'json'};

const object=v.record(v.string(),v.unknown());
function structure(schema:Readonly<Record<string,unknown>>):Record<string,unknown>{const {$schema:_schema,...body}=schema;return body;}

test('wildlife metadata shares whole original return grammars without dropping constraints',()=>{
 const schema=registeredJsonSchema('actors/wildlife.json'),definitions=v.parse(object,schema['definitions']),properties=v.parse(object,schema['properties']);
 expect(properties['admission']).toEqual({$ref:'#/definitions/legacyReturn'});
 expect(properties['pasture']).toEqual({$ref:'#/definitions/legacyReturn'});
 const legacy=structure(namedJsonSchema(ReturnProgramSchema)),legacyProperties=v.parse(object,legacy['properties']);
 expect(definitions['legacyReturn']).toEqual({...legacy,properties:{...legacyProperties,v2:{$ref:'#/definitions/projection'}}});
 expect(definitions['projection']).toEqual(structure(namedJsonSchema(ReturnProjectionV2Schema)));
 expect(schema['$comment']).toBe('@wildshard/format/wildlifePopulation#WildlifePopulationSchema');
});
test('factored metadata retains the complete original population and every original wire/native refusal',()=>{
 const schema=registeredJsonSchema('actors/wildlife.json'),fixture=roots['actors/wildlife.json'];
 const original:unknown=JSON.parse(fixture.body),body=v.parse(WildlifePopulationSchema,original),before=JSON.stringify(original);
 expect(body).toEqual(original);
 expect(validateNamedJsonSchema(schema,new TextEncoder().encode(fixture.body))).toEqual(original);
 for(const input of [{...body,admission:{...body.admission,bytes:4}},
  {...body,pasture:{...body.pasture,v2:{}}},{...body,foreign:true}]){
  expect(()=>v.parse(WildlifePopulationSchema,input)).toThrow();
  expect(()=>validateNamedJsonSchema(schema,new TextEncoder().encode(JSON.stringify(input)))).toThrow();
 }
 expect(JSON.stringify(original)).toBe(before);
});
