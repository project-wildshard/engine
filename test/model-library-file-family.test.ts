import {expect,test} from 'vitest';
import * as v from 'valibot';
import {FixedDrawRowsSchema} from '@wildshard/format/fixedDraws';
import {platformFileFamily,validatePlatformFile} from '@wildshard/format/platformFileFamilies';
import {fixedDraws} from '../src/client/game/models/fixedDraws';
import {registeredJsonSchema} from '../src/shared/host/formatJsonSchema';
import roots from './fixtures/fixed-draw-root-users.json' with {type:'json'};

const name='models/shape-book.json',source='@wildshard/format/fixedDraws#FixedDrawRowsSchema';

test('the fixed-draw file family admits complete real DW and Nalati roots verbatim',()=>{
  expect(roots['driftwood-isle']).toHaveLength(90);
  expect(roots['nalati-grasslands']).toHaveLength(50);
  expect(platformFileFamily(name,source)?.schema).toBe(FixedDrawRowsSchema);
  expect(registeredJsonSchema(name)['$comment']).toBe(source);
  for(const [slug,input]of Object.entries(roots)) {
    const before=structuredClone(input),rows=v.parse(FixedDrawRowsSchema,input);
    expect(rows).toEqual(input);expect(input).toEqual(before);
    expect(validatePlatformFile(name,source,input)).toBeDefined();
    const library=fixedDraws({slug,file:()=>Promise.reject(new Error('No binary reads before load'))},input);
    expect(library.ready).toBe(false);expect(library.handle(rows[0]?.slot??'missing')).toBeDefined();
  }
});

test('registration retains exact rows and native slot/binary refusals',()=>{
  const rows=v.parse(FixedDrawRowsSchema,roots['nalati-grasslands']),first=rows[0];
  if(first===undefined)throw new Error('Missing actual fixed-draw row');
  for(const input of [[{...first,callback:()=>0}],[{...first,channels:[['position','position','extra']]}],[{...first,foreign:1}],{rows}])
    expect(()=>validatePlatformFile(name,source,input)).toThrow();
  const product={slug:'fixture',file:()=>Promise.reject(new Error('No binary reads before load'))};
  expect(()=>fixedDraws(product,[first,first])).toThrow('Repeated fixed draw slot');
  const baked=rows.find(row=>'baked'in row)?.baked;
  if(baked===undefined)throw new Error('Missing actual baked shape');
  expect(()=>fixedDraws(product,[{slot:'inline',channels:[],inline:'AA==',baked}])).toThrow('Fixed draws require binary sources');
  expect(platformFileFamily(name,undefined)).toBeUndefined();
  expect(platformFileFamily(name,'@wildshard/format/fixedDraws#OtherSchema')).toBeUndefined();
  expect(platformFileFamily('models/private-shape-book.json',source)).toBeUndefined();
});
