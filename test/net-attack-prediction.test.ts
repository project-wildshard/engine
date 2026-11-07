import { expect, test } from 'vitest';
import { AttackPrediction } from '../src/client/engine/net/attackPrediction';

// P1-E5.3-E5: what becomes of a start, from the owner block's two numbers.
test('a start is confirmed by lastSwingSeq, refused once lastSeq passes it, and undecided before', () => {
  const attacks = new AttackPrediction(), refused: number[] = [];
  attacks.onRefused(seq => { refused.push(seq); });
  attacks.started(10); attacks.started(20);
  attacks.frame(8, 0); expect(attacks.pending).toBe(2);
  attacks.frame(10, 10); expect(attacks.pending).toBe(1); expect(refused).toEqual([]);
  attacks.frame(19, 10); expect(attacks.pending).toBe(1);
  attacks.frame(20, 10); expect(refused).toEqual([20]); expect(attacks.refused).toBe(1); expect(attacks.pending).toBe(0);
});

test('a hit confirms ahead of its frame, and seqs wrap', () => {
  const attacks = new AttackPrediction(), refused: number[] = [];
  attacks.onRefused(seq => { refused.push(seq); });
  attacks.started(0xfffe); attacks.started(1);
  attacks.confirm(0xfffe); expect(attacks.pending).toBe(1);
  attacks.frame(0xffff, 0xfffe); expect(attacks.pending).toBe(1);
  attacks.frame(3, 1); expect(attacks.pending).toBe(0); expect(refused).toEqual([]);
});

test('an unanswered stream stays bounded', () => {
  const attacks = new AttackPrediction();
  for (let seq = 1; seq < 100; seq++) attacks.started(seq);
  expect(attacks.pending).toBe(8);
});
