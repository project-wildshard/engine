import { expect, test } from 'vitest';
import * as v from 'valibot';
import runtimeFixture from './fixtures/quest-runtime.json' with { type: 'json' };
import roots from './fixtures/approved-quest-complete.json' with { type: 'json' };
import { QuestRuntimeDocumentSchema } from '@wildshard/format/questRuntime';
import { QuestStoryBindingsSchema } from '@wildshard/format/questStoryBindings';
import { parseQuestLeadPage, parseQuestSpawnPage, parseQuestStepRows } from '@wildshard/format/questSteps';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';
import { validateTable } from '../src/shared/engine/world/interact/validate';

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(encodeCanonicalJson(value));

test('the complete runtime and story grammar preserve original data and serialized admission', () => {
  const runtime = v.parse(QuestRuntimeDocumentSchema, runtimeFixture);
  expect(runtime).toEqual(runtimeFixture);
  expect(encode(runtime)).toHaveLength(29_289);
  expect(hashImmutableBytes(encode(runtime))).toBe('92d6503d0356e9140fa1362f767f5fd24c12d9512cf81847d66450dc62cb65bf');
  expect(validateNamedJsonSchema(namedJsonSchema(QuestRuntimeDocumentSchema), encode(runtimeFixture))).toEqual(runtimeFixture);
  const fixture = roots['quests/forest-story.json'], input: unknown = JSON.parse(fixture.body);
  const story = v.parse(QuestStoryBindingsSchema, input);
  expect(story).toEqual(input);
  expect(new TextEncoder().encode(fixture.body)).toHaveLength(7_937);
  expect(hashImmutableBytes(new TextEncoder().encode(fixture.body))).toBe(fixture.sha256);
  expect(validateNamedJsonSchema(namedJsonSchema(QuestStoryBindingsSchema), new TextEncoder().encode(fixture.body))).toEqual(input);
  expect(() => v.parse(QuestStoryBindingsSchema, { ...story, board: { ...story.board, radius: 0 } })).toThrow();
  expect(() => v.parse(QuestStoryBindingsSchema, { ...story, store: { ...story.store, slot: '' } })).toThrow();
});

test('the complete runtime retains native table, step, lead and spawn admission', () => {
  const row = v.parse(QuestRuntimeDocumentSchema, runtimeFixture);
  expect(validateTable(row.table)).toEqual([]);
  expect(parseQuestLeadPage(row.leadPage)).toEqual(row.leadPage);
  expect(parseQuestSpawnPage(row.spawns)).toEqual(row.spawns);
  expect(parseQuestStepRows(row.steps)).toEqual(row.steps);
  for (const invalid of [
    { ...row, lead: { ...row.lead, program: { ...row.lead.program, script: { ...row.lead.program.script, abi: 'invalid' } } } },
    { ...row, content: { ...row.content, trader: { ...row.content.trader, rows: [{ foreign: true }] } } },
    { ...row, events: [{ types: ['open'], effects: [{ kind: 'call', name: 'unbound', foreign: true }] }] },
    { ...row, deaths: [{ effects: [{ kind: 'flag', flag: 'done', foreign: true }] }] },
    { ...row, policy: { readingDelay: -1 } },
  ]) expect(() => v.parse(QuestRuntimeDocumentSchema, invalid)).toThrow();
});

test('the forest story changes only the approved binding token and refuses legacy transport', () => {
  const fixture = roots['quests/forest-story.json'], original = fixture.body.replace('quests/runtime.json', 'custom/questRuntime');
  expect(hashImmutableBytes(new TextEncoder().encode(original))).toBe(fixture.originalSha256);
  expect(new TextEncoder().encode(original)).toHaveLength(7_937);
  const row = v.parse(QuestStoryBindingsSchema, JSON.parse(fixture.body));
  expect(() => v.parse(QuestStoryBindingsSchema, { ...row, content: 'custom/questRuntime' })).toThrow();
  expect(() => v.parse(QuestStoryBindingsSchema, { ...row, pool: { ...row.pool, still: { ...row.pool.still, surface: { ...row.pool.still.surface, foreign: true } } } })).toThrow();
});
