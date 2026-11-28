import { describe, expect, test } from 'vitest';
import { indexKeys, missingCooks, PREFILL_COMMAND, prefillRefusal } from '../src/scripts/cook-prefill.mjs';

// Meta QA 11-26 row 92: v0.1.103's train held at local QA because no pinned zone had an index at the moved cook hash.
const hash = (c: string) => c.repeat(64);
const recipe = { cookVersion: '1.21.0', cookHash: hash('a'), sameOutputFrom: hash('b') };
const pins = [
  { slug: 'brasscap-mesa', shardVersion: '0.5.21', hash: hash('1') },
  { slug: 'glowfen', shardVersion: '0.3.6', hash: hash('2') },
];
const keys = { R2_ACCOUNT_ID: 'acct', R2_COOKED_ACCESS_KEY_ID: 'id', R2_COOKED_SECRET_ACCESS_KEY: 'secret' };

describe('cook prefill', () => {
  test('each pin needs its index at the tree\'s cook', () => {
    expect(indexKeys(pins, recipe).map(row => row.key)).toEqual([
      `shards/brasscap-mesa/0.5.21/cooks/1.21.0/${hash('a')}/index.json`,
      `shards/glowfen/0.3.6/cooks/1.21.0/${hash('a')}/index.json`,
    ]);
  });

  test('a 404 index is missing, a 200 is held, anything else refuses', async () => {
    const held = new Set([indexKeys(pins, recipe)[1]?.key]);
    expect((await missingCooks(pins, recipe, async key => held.has(key) ? 200 : 404)).map(pin => pin.slug)).toEqual(['brasscap-mesa']);
    expect(await missingCooks(pins, recipe, async () => 200)).toEqual([]);
    await expect(missingCooks(pins, recipe, async () => 503)).rejects.toThrow(/answered 503/u);
  });

  test('missing indexes without the cook keys refuse and name the command', () => {
    expect(prefillRefusal([], recipe, {})).toBeUndefined();
    expect(prefillRefusal(pins, recipe, keys)).toBeUndefined();
    const refusal = prefillRefusal(pins.slice(0, 1), recipe, { R2_ACCOUNT_ID: 'acct' });
    expect(refusal).toContain('1 zone(s) have no index at cook 1.21.0 aaaaaaaaaaaa (brasscap-mesa)');
    expect(refusal).toContain('R2_COOKED_ACCESS_KEY_ID, R2_COOKED_SECRET_ACCESS_KEY are unset');
    expect(refusal).toContain(PREFILL_COMMAND);
  });
});
