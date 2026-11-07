import { expect, test } from 'vitest';
import * as v from 'valibot';
import runtimeFixture from './fixtures/quest-runtime.json' with { type: 'json' };
import roots from './fixtures/approved-quest-complete.json' with { type: 'json' };
import { QuestRuntimeDocumentSchema } from '@wildshard/format/questRuntime';
import { QuestStoryBindingsSchema } from '@wildshard/format/questStoryBindings';
import { ChapterViewSchema } from '@wildshard/format/questPageComposition';
import { platformFileFamily, validatePlatformFile } from '@wildshard/format/platformFileFamilies';
import { registeredJsonSchema } from '../src/shared/host/formatJsonSchema';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(encodeCanonicalJson(value));
const json = (text: string): unknown => JSON.parse(text);
const cases = [
  { name: 'quests/runtime.json', schema: QuestRuntimeDocumentSchema, input: runtimeFixture,
    bytes: encode(runtimeFixture), hash: '92d6503d0356e9140fa1362f767f5fd24c12d9512cf81847d66450dc62cb65bf', length: 29_289 },
  { name: 'quests/forest-story.json', schema: QuestStoryBindingsSchema,
    input: json(roots['quests/forest-story.json'].body), bytes: new TextEncoder().encode(roots['quests/forest-story.json'].body),
    hash: roots['quests/forest-story.json'].sha256, length: 7_937 },
  { name: 'quests/content.json', schema: ChapterViewSchema,
    input: json(roots['quests/content.json'].body), bytes: new TextEncoder().encode(roots['quests/content.json'].body),
    hash: roots['quests/content.json'].sha256, length: 20_411 },
] as const;

for (const row of cases) test(`${row.name} keeps the complete original wire and exact defining provenance`, () => {
  const input: unknown = row.input, before = JSON.stringify(input), schema = registeredJsonSchema(row.name);
  const source = schema?.['$comment'];
  if (schema === undefined || typeof source !== 'string') throw new Error('Missing complete quest contract');
  expect(row.bytes.byteLength).toBe(row.length);
  expect(hashImmutableBytes(row.bytes)).toBe(row.hash);
  expect(platformFileFamily(row.name, source)?.schema).toBe(row.schema);
  expect(v.parse(row.schema, input)).toEqual(input);
  expect(encode(v.parse(row.schema, input))).toEqual(encode(input));
  expect(validateNamedJsonSchema(schema, row.bytes)).toEqual(input);
  expect(validatePlatformFile(row.name, source, input)?.schema).toBe(row.schema);
  expect(platformFileFamily(row.name, undefined)).toBeUndefined();
  expect(platformFileFamily(row.name, `${source}Other`)).toBeUndefined();
  expect(platformFileFamily(`private/${row.name}`, source)).toBeUndefined();
  expect(() => validatePlatformFile(row.name, source, { ...v.parse(v.record(v.string(), v.unknown()), input), foreign: true })).toThrow();
  expect(JSON.stringify(input)).toBe(before);
});

test('Nalati content closes figure metadata and its full native return guest', () => {
  const row = v.parse(ChapterViewSchema, JSON.parse(roots['quests/content.json'].body));
  expect(() => v.parse(ChapterViewSchema, { ...row, program: { ...row.program, script: { ...row.program.script, abi: 'invalid' } } })).toThrow();
  const figures = row.figures;
  if (figures === undefined) throw new Error('Missing original figure group');
  const first = Object.values(figures.figures)[0];
  if (first === undefined) throw new Error('Missing original placed figure');
  expect(() => v.parse(ChapterViewSchema, { ...row, figures: { ...figures, figures: [{ ...first, frame: { ...first.frame, radius: 'wide' } }] } })).toThrow();
});
