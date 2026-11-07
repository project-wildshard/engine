import { expect, test } from 'vitest';
import rows from './fixtures/nalati-weather-original.json' with { type: 'json' };
import { originalScriptOrder } from './fixtures/original-script-order';
import { parseDecisionScripts } from '../src/sharddev/decisionScripts';

test('original wire order survives admission without changing any script value', () => {
  const admitted = parseDecisionScripts([rows.script])[0];
  if (admitted === undefined) throw new Error('Missing original weather script');
  const original = originalScriptOrder(rows.script, admitted);
  expect(original).toEqual(admitted);
  expect(JSON.stringify(original)).toBe(JSON.stringify(rows.script));
  expect(original).not.toBe(rows.script);
  original.pages++;
  expect(rows.script.pages).toBe(admitted.pages);
});

test('original wire restoration refuses changes, omitted fields and extra fields', () => {
  const admitted = parseDecisionScripts([rows.script])[0];
  if (admitted === undefined) throw new Error('Missing original weather script');
  const { pages: _pages, ...missing } = rows.script;
  for (const changed of [{ ...rows.script, pages: admitted.pages + 1 },
    { ...rows.script, sourceHash: '0'.repeat(64) }, { ...rows.script, fields: {} },
    { ...rows.script, unexpected: true }, missing]) {
    expect(() => originalScriptOrder(changed, admitted)).toThrow();
  }
});
