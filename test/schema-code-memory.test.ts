import { nalatiSpecimens } from './fixtures/nalati-specimens';
import { nalatiBalbal } from './fixtures/nalati-balbal';
import { nalatiRuntime } from './fixtures/nalati-runtime';
import { nalatiDecorative } from './fixtures/nalati-decorative';
import { expect, test } from 'vitest';
import conditionalSchema from './fixtures/schema-conditionals.json' with { type: 'json' };
import { schemaReferences } from '../src/shared/game/shardfile/schemaReferences';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';
import { validateDefinedJson } from '../src/sharddev/sections';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { encodeCanonicalJson } from '../src/shared/host/immutable';
import { SceneDressingSchema } from '@wildshard/format/sceneDressing';
import { dressingScene } from './fixtures/nalati-dressing-scene';

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(encodeCanonicalJson(value));
const accepts = (work: () => unknown): boolean => { try { work(); return true; } catch { return false; } };

test('real dressing retains author/runtime acceptance and nested refusal without schema mutation', () => {
  const schema = namedJsonSchema(SceneDressingSchema), original = encodeCanonicalJson(schema), schemaBytes = encode(schema);
  const rows = dressingScene('phone',nalatiDecorative,nalatiRuntime,nalatiBalbal,nalatiSpecimens), layer = rows.layers[0], first = rows.statics[0];
  if (layer === undefined || first === undefined) throw new Error('Missing actual dressing rows');
  const candidates = [rows,
    { ...rows, layers: [{ ...layer, far: 'distant' }] },
    { ...rows, statics: [{ ...first, members: [{ model: 42 }] }] },
    { ...rows, geometry: { invalid: { kind: 'baked', url: 8 } } },
  ];
  for (const [index, value] of candidates.entries()) {
    const bytes = encode(value);
    const author = accepts(() => validateDefinedJson(schemaBytes, bytes));
    expect(author).toBe(index === 0);
    expect(accepts(() => validateNamedJsonSchema(schema, bytes))).toBe(author);
  }
  expect(encodeCanonicalJson(schema)).toBe(original);
  const factored = schemaReferences(schema, original);
  expect(JSON.stringify(factored).length).toBeLessThan(original.length);
  expect(encodeCanonicalJson(validateNamedJsonSchema(schema, encode(rows)))).toBe(encodeCanonicalJson(rows));
});

test('data-valued keywords and existing reference bases retain their original meanings', () => {
  const data = { properties: { items: { type: 'an actual data string' } }, note: 'x'.repeat(17_000) };
  const schema = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', const: data };
  const factored = schemaReferences(schema, JSON.stringify(schema));
  expect('const' in factored && factored.const).toBe(data);
  expect(validateNamedJsonSchema(schema, encode(data))).toEqual(data);
  expect(() => validateNamedJsonSchema(schema, encode({ ...data, note: 'changed' }))).toThrow('refuses its schema');
  for (const reserved of [{ $id: 'https://example.test/schema' }, { $ref: '#/definitions/item' }, { definitions: { item: { type: 'string' } } }]) {
    const existing = { ...schema, ...reserved };
    expect(schemaReferences(existing, JSON.stringify(existing))).toBe(existing);
  }
});

test('factored tuple, dependency, conditional and disjunction rules match the author validator', () => {
  const schema = { ...conditionalSchema, $comment: 'x'.repeat(17_000) };
  const samples = [
    { mode: 'strict', options: ['x', 2], values: [0, 1] }, { mode: 'loose', trigger: true, count: 1 },
    { mode: 'strict' }, { mode: 'loose', options: ['x'] }, { mode: 'loose', trigger: true },
    { mode: 'strict', options: ['x', 2, 3] }, { mode: 'loose', values: [0] },
  ];
  for (const [index, value] of samples.entries()) {
    const bytes = encode(value), author = accepts(() => validateDefinedJson(encode(schema), bytes));
    expect(author).toBe(index < 2);
    expect(accepts(() => validateNamedJsonSchema(schema, bytes))).toBe(author);
  }
});
