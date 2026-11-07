import { expect, test } from 'vitest';
import { bindFrameBudget, type BudgetControl } from '../scripts/parity/frame-budget.mjs';

function fixture() {
  let nativeGate = true, serial = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const game = { frameCount: 3, frameGate: () => nativeGate };
  const control: BudgetControl = { remaining: 0, free: false, advance: () => Promise.reject(new Error('Not installed')) };
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Exercise the browser RAF callback contract with an explicitly driven queue.
  const dispose = bindFrameBudget(game, control, callback => { const id = ++serial; callbacks.set(id, callback); return id; }, id => { callbacks.delete(id); });
  const tick = (): void => { const runs = [...callbacks.values()]; callbacks.clear(); for (const run of runs) run(0); };
  return { game, control, dispose, tick, block: () => { nativeGate = false; } };
}

test('status queries never consume a budget; only completed draws satisfy advance', async () => {
  const f = fixture(), completed = f.control.advance(2);
  for (let i = 0; i < 100; i++) expect(f.game.frameGate()).toBe(true);
  expect(f.control.remaining).toBe(2); f.tick();
  f.game.frameCount++; f.tick(); expect(f.control.remaining).toBe(1);
  for (let i = 0; i < 100; i++) expect(f.game.frameGate()).toBe(true);
  f.game.frameCount++; f.tick(); await completed;
  expect(f.control.remaining).toBe(0); expect(f.game.frameGate()).toBe(false); f.dispose();
});

test('the original native gate remains authoritative and concurrent requests refuse', async () => {
  const f = fixture(), completed = f.control.advance(1);
  await expect(f.control.advance(1)).rejects.toThrow('concurrent');
  f.block(); expect(f.game.frameGate()).toBe(false); expect(f.control.remaining).toBe(1);
  f.dispose(); await expect(completed).rejects.toThrow('retired');
  expect(f.game.frameGate()).toBe(false); await expect(f.control.advance(1)).rejects.toThrow('retired');
});

test('free capture bypasses only its budget, and zero advance schedules no draw', async () => {
  const f = fixture(); await f.control.advance(0);
  expect(f.game.frameGate()).toBe(false); f.control.free = true; expect(f.game.frameGate()).toBe(true);
  f.block(); expect(f.game.frameGate()).toBe(false); await expect(f.control.advance(1)).rejects.toThrow('concurrent'); f.dispose();
});
