import { expect, test } from 'vitest';
import * as v from 'valibot';
import { ReturnProgramDocumentSchema } from '@wildshard/format/returnProgramDocument';
import { DecisionScriptsSchema, type DecisionScriptRowInput } from '@wildshard/format/decisionScripts';
import { namedJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const script: DecisionScriptRowInput = {
  id: 'return.fixture', abi: '1.0', side: 'sim', module: `blobs/wasm/${'a'.repeat(64)}.wasm`,
  source: 'behaviour/return.as', binding: { shard: true }, onFail: 'hold',
  on: ['start'], reads: [], commands: [], stateVersion: 1, state: [], params: {},
};
const good = { script, bytes: '' };

test('complete return documents retain original native script admission without replacing caller bytes', () => {
  const before = JSON.stringify(good);
  const value = v.parse(ReturnProgramDocumentSchema, good);
  expect(value.script).toEqual(v.parse(DecisionScriptsSchema, [script])[0]);
  expect(JSON.stringify(good)).toBe(before);
  expect(value.bytes).toBe('');
  expect(v.parse(ReturnProgramDocumentSchema, { ...good, signal: 'blade' }).signal).toBe('blade');
});

test('complete return documents refuse partial scripts and the native ABI, source, range and unsafe-name negatives', () => {
  for (const value of [{ ...good, script: {} }, { ...good, script: null }, { ...good, script: { ...script, abi: '2.0' } },
    { ...good, script: { ...script, module: 'private.wasm' } }, { ...good, script: { ...script, source: 'behaviour/generated/return.as' } },
    { ...good, script: { ...script, pages: 5 } }, { ...good, script: { ...script, on: ['start', 'start'] } },
    { ...good, script: { ...script, timers: ['timer', 'timer'] } }, { ...good, script: { ...script, params: { constructor: 1 } } },
    { ...good, v2: { artifact: {} } }, { ...good, bytes: () => '' }, { ...good, callback: true }]) {
    expect(() => v.parse(ReturnProgramDocumentSchema, value)).toThrow();
  }
});

test('the defining JSON projection describes the whole script and retains unknown-author-check refusal', () => {
  const schema = namedJsonSchema(ReturnProgramDocumentSchema, { provenance: true });
  expect(schema).toMatchObject({
    $comment: '@wildshard/format/returnProgramDocument#ReturnProgramDocumentSchema',
    additionalProperties: false,
    properties: { script: { type: 'object', additionalProperties: false,
      required: expect.arrayContaining(['id', 'abi', 'side', 'module', 'source', 'binding', 'on', 'reads', 'commands', 'stateVersion', 'state', 'params']) } },
  });
  const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  expect(() => validateNamedJsonSchema(schema, bytes(v.parse(ReturnProgramDocumentSchema, good)))).not.toThrow();
  expect(() => validateNamedJsonSchema(schema, bytes({ ...good, script: { id: 'return.fixture' } }))).toThrow();
  expect(() => namedJsonSchema(v.pipe(v.string(), v.check(() => true)))).toThrow();
});

test('rejected script accessors are never invoked by later validation checks', () => {
  let reads = 0;
  const value = { bytes: '' };
  Object.defineProperty(value, 'script', { enumerable: true, get: () => { reads++; return script; } });
  expect(v.safeParse(ReturnProgramDocumentSchema, value).success).toBe(false);
  expect(reads).toBe(0);
});
