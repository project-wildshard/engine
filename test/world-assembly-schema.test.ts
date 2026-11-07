import { expect, test } from 'vitest';
import * as v from 'valibot';
import { WorldAssemblySchema } from '@wildshard/format/worldAssembly';
import { formatJsonSchema, namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';
import { worldAssemblyRows } from '../src/sharddev/worldScenes';

const models = { stages: [{ kind: 'drawn-models', id: 'orchard.signs', look: {painterly: {rim: 0.4}}, models: [{id: 'north', draw: 'sign:north'}] }] };

test('the defining assembly root emits structural rows and retains its explicit admission checks', () => {
  const schema = namedJsonSchema(WorldAssemblySchema);
  expect(JSON.stringify(formatJsonSchema(WorldAssemblySchema))).toContain('@wildshard/format/worldAssembly#WorldAssemblySchema');
  const admitted = validateNamedJsonSchema(schema, new TextEncoder().encode(JSON.stringify(models)));
  expect(v.parse(WorldAssemblySchema, admitted)).toEqual(models);
  expect(worldAssemblyRows(models)).toEqual(v.parse(WorldAssemblySchema, admitted));
  expect(v.safeParse(WorldAssemblySchema, {stages: [{...models.stages[0], models: [{id: 'same', draw: 'one'}, {id: 'same', draw: 'two'}]}]}).success).toBe(false);
  expect(v.safeParse(WorldAssemblySchema, {stages: [{...models.stages[0], arbitrary: true}]}).success).toBe(false);
  expect(() => worldAssemblyRows({stages: [{...models.stages[0], models: [{id: 'same', draw: 'one'}, {id: 'same', draw: 'two'}]}]})).toThrow();
  expect(() => worldAssemblyRows({stages: [{...models.stages[0], arbitrary: true}]})).toThrow();
});

test('assembly emission does not grant a bridge to a foreign custom predicate', () => {
  const foreign = v.pipe(v.strictObject({id: v.string()}), v.check(row => row.id.length > 0));
  expect(() => namedJsonSchema(foreign)).toThrow('check');
});


test('arena room variants retain the original open wire and refuse mixed room resources',()=>{
  const open={kind:'arena-room',id:'orchard.open',files:{fight:'fight.json',geometry:'geometry.json'},weather:'weather',anchor:'tie'};
  const room={kind:'arena-room',mode:'room',id:'orchard.room',file:'fight.json',entrance:{part:'garden',anchor:'entry'}};
  expect(worldAssemblyRows({stages:[open]})).toEqual(v.parse(WorldAssemblySchema,{stages:[open]}));
  expect(worldAssemblyRows({stages:[room]})).toEqual(v.parse(WorldAssemblySchema,{stages:[room]}));
  expect(()=>worldAssemblyRows({stages:[{...open,...room}]})).toThrow();
  expect(()=>worldAssemblyRows({stages:[{...room,mode:'anything'}]})).toThrow();
});
