import { expect, test } from 'vitest';
import { preflightShardfile } from '@wildshard/format/preflight';
import { SHARDFILE_ADMISSION_LIMITS as limits } from '@wildshard/format/admissionLimits';

const utf8 = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

// T10: preflight counts the source's serialized UTF-8 length without serializing plain strings, integers, booleans or null.
// Its count must stay JSON.stringify's: a source of exactly the cap is admitted and one byte more is refused.
test('preflight admits a source of exactly the byte cap and refuses one byte more, for every kind of value', () => {
  const mixed = {
    text: ['plain', String.raw`quote " and \ backslash`, 'tab\tnew\nline', 'control \u0001', 'é and 日本', 'emoji 🦊', ''],
    numbers: [0, 7, -7, 10, 99, 100, -1000, 123456789, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 1e21, 2 ** 60, 0.5, -0.25, 1 / 3, 1e-7, 6.02e23],
    flags: [true, false, null],
    nested: { id: 'shard-id', name: 'Pine', deep: [[{ a: 1 }, []], {}], bounds: { x0: -1, x1: 1, z0: -2, z1: 2 } },
  };
  // pad with ≤ 4096-character strings until the source is exactly the cap
  const sized = (extra: number): { mixed: typeof mixed; pad: string[] } => {
    const pad: string[] = [], source = { mixed, pad };
    for (;;) {
      const missing = limits.sourceBytes + extra - utf8(source);
      if (missing <= 0) break;
      // one more element costs its quotes and a comma (none for the first)
      const overhead = pad.length === 0 ? 2 : 3;
      pad.push('x'.repeat(Math.max(0, Math.min(limits.textCharacters, missing - overhead))));
    }
    expect(utf8(source)).toBe(limits.sourceBytes + extra);
    return source;
  };
  expect(() => { preflightShardfile(sized(0)); }).not.toThrow();
  expect(() => { preflightShardfile(sized(1)); }).toThrow('Shardfile source exceeds admission cap');
});

test('cell bounds still name the refused node by its path', () => {
  expect(() => { preflightShardfile({ rows: [{ a: 1 }, { place: { min: [0, 0, 0], max: [251, 1, 1] } }] }); }).toThrow('Out-of-cell bounds: shardfile.rows[1].place');
  expect(() => { preflightShardfile({ rows: [{ zone: { x0: 2, x1: 1, z0: 0, z1: 1 } }] }); }).toThrow('Out-of-cell bounds: shardfile.rows[0].zone');
  expect(() => { preflightShardfile({ rows: [{ zone: { x0: 0, x1: 1, z0: 0, z1: '1' } }] }); }).not.toThrow();
});
