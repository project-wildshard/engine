import { expect, test } from 'vitest';
import { fingerprintLines, fingerprintsOf, sideAt } from '../src/scripts/fingerprints.ts';

// SHARD-COMPAT SP4: CI prints the fingerprints a push moves. A render edit moves the renderer (and the cook, which
// names it); a doc edit moves none; the format and chain lines move with the format pin.
const head = { renderer: 'r'.repeat(64), cook: 'c'.repeat(64), formatPin: 'npm:@wildshard/shard-format@0.69.2' };
const format = { version: '0.1.0.2', chain: 'd'.repeat(64) };

test('a doc edit moves no fingerprint', () => {
  expect(fingerprintLines('a'.repeat(40), { head, base: head }, format)).toEqual({
    lines: [`fingerprints against ${'a'.repeat(12)}:`, `renderer: same ${'r'.repeat(12)}`, `cook: same ${'c'.repeat(12)}`,
      'format: same 0.1.0.2 (pin npm:@wildshard/shard-format@0.69.2)', `chain: same ${'d'.repeat(12)}`],
    moved: [],
  });
});

test('a render edit moves the renderer and the cook; a pin move moves format and chain', () => {
  const rendered = { ...head, renderer: 'x'.repeat(64), cook: 'y'.repeat(64) };
  expect(fingerprintLines('b'.repeat(40), { head, base: rendered }, format).moved).toEqual(['renderer', 'cook']);
  const pinned = { ...head, formatPin: 'npm:@wildshard/shard-format@0.69.1' };
  const lines = fingerprintLines('b'.repeat(40), { head, base: pinned }, undefined).lines;
  expect(lines.slice(3)).toEqual(['format: moved (pin npm:@wildshard/shard-format@0.69.2, was npm:@wildshard/shard-format@0.69.1)', 'chain: moved (follows the pin)']);
});

test("HEAD against itself moves nothing, on the checkout's own files", () => {
  const side = sideAt('HEAD');
  expect(fingerprintsOf(side, ['package.json'])).toEqual(fingerprintsOf(sideAt('HEAD'), ['package.json']));
});
