import { expect,test } from 'vitest';
import { readArenaScriptData } from '../src/shared/game/boss/openArenaFight';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { nalatiPin } from './fixtures/engine-lift/pins';

test('the admitted arena file binds its real host and refuses corrupt health, field and roster declarations', async () => {
  const product = nalatiPin.product, name = 'combat/titan-fight.json';
  const file = outputDescriptor(product.shardfile)?.index.files.find(row => row.name === name);
  if (file?.jsonSchema === undefined) throw new Error('Missing defining arena schema');
  const fight = await product.json(name);
  const data = await readArenaScriptData(product, { fight: name, geometry: 'combat/titan-geometry.json' });
  expect(data.place.heartHp).toBeGreaterThan(0);
  for (const arenaScript of [
    { ...fight.arenaScript, place: { ...fight.arenaScript.place, heartHp: 'many' } },
    { ...fight.arenaScript, field: { ...fight.arenaScript.field, width: 65 } },
    { ...fight.arenaScript, support: { ...fight.arenaScript.support, actors: { ...fight.arenaScript.support.actors, hp: 0 } } },
  ]) {
    const wire = new TextEncoder().encode(JSON.stringify({ ...fight, arenaScript }));
    expect(() => validateNamedJsonSchema(file.jsonSchema, wire)).toThrow('refuses its schema');
  }
});

test('the published timed encounter refuses excess patrols and malformed motion before installing actors', async () => {
  const product = nalatiPin.product, name = 'combat/timed-encounters.json';
  const file = outputDescriptor(product.shardfile)?.index.files.find(row => row.name === name);
  if (file?.jsonSchema === undefined) throw new Error('Missing timed-encounter schema');
  const rows = await product.json(name);
  for (const bad of [
    { ...rows, patrol: { ...rows.patrol, actors: { ...rows.patrol.actors, count: 9 } } },
    { ...rows, motion: { ...rows.motion, parameters: { bad: 'not numeric' } } },
  ]) expect(() => validateNamedJsonSchema(file.jsonSchema, new TextEncoder().encode(JSON.stringify(bad)))).toThrow('refuses its schema');
});
