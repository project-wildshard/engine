import { expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the exact serialized browser hook in isolation.
import { runInNewContext } from 'node:vm';
import { bridgeVerdict, installBridgeCorrections, proofVerdict } from '../scripts/net-lag-verdict.mjs';

const crossing = { reached: true, under: 0, falls: 0, corrections: 2, injectedSinks: [0.3, 1], forcedFrames: 30, forcedFrameMs: 60, spanSamples: 8, lowest: 5.4 };

test('a bridge correctness run never certifies timing metrics', () => {
  const result = proofVerdict({ b1: { ok: false }, b2: { ok: false }, b3: { ok: false }, b4: bridgeVerdict(crossing) }, 'correctness');
  expect(result).toMatchObject({ ok: true, measurement: 'correctness', checked: ['b4'] });
  for (const key of ['b1', 'b2', 'b3']) expect(result).not.toHaveProperty(key);
});

test('missing or unexercised bridge telemetry cannot pass', () => {
  for (const missing of ['under', 'falls', 'corrections', 'injectedSinks', 'forcedFrames', 'forcedFrameMs', 'spanSamples', 'lowest'] as const) {
    const sample: Partial<typeof crossing> = { ...crossing }; delete sample[missing];
    expect(bridgeVerdict(sample).ok, missing).toBe(false);
  }
  for (const sample of [{ corrections: 0 }, { forcedFrames: 0 }, { forcedFrameMs: 16 }, { falls: 1 }, { under: 1 }, { reached: false }]) {
    expect(bridgeVerdict({ ...crossing, ...sample }).ok).toBe(false);
  }
});

test('timing qualification still requires every requested bar', () => {
  expect(proofVerdict({ b1: { ok: true }, b2: { ok: false }, b3: { ok: true }, b4: bridgeVerdict(crossing) }, 'timing').ok).toBe(false);
  const timing = { b1: { ok: true }, b2: { ok: true }, b3: { ok: true } };
  expect(proofVerdict(timing, 'timing').ok).toBe(true);
  expect(proofVerdict({ ...timing, error: 'page failed' }, 'timing').ok).toBe(false);
  expect(proofVerdict({ b4: bridgeVerdict(crossing), error: 'page failed' }, 'correctness').ok).toBe(false);
  expect(proofVerdict({ b4: bridgeVerdict(crossing), errors: ['uncaught page error'] }, 'correctness').ok).toBe(false);
});

test('bridge faults replace only selected owner frames and require observed replay', () => {
  interface Frame { tick: number; owner: Float64Array }
  class Client {
    latest: Frame = { tick: 1, owner: new Float64Array([0, 6, 0]) };
    frames = new Set<(frame: Frame) => void>();
    corrections = new Set<(row: { tick: number; offset: number }) => void>();
    rendered(): void {}
    owner(frame: { owner: Float64Array }): { py: number } { return { py: frame.owner[1] ?? 0 }; }
    onFrame(fn: (frame: Frame) => void): () => void { this.frames.add(fn); return () => { this.frames.delete(fn); }; }
    onCorrection(fn: (row: { tick: number; offset: number }) => void): () => void { this.corrections.add(fn); return () => { this.corrections.delete(fn); }; }
    receive(frame: Frame): void { this.latest = frame; for (const fn of this.frames) fn(frame); }
  }
  const original = Client.prototype.rendered, main = new Client(), bot = new Client(), end = vi.fn();
  const state = { slowMs: 60, bridgeFault: undefined as undefined | { ready: boolean; armed: number; confirmed: { sink: number }[]; cleanup: () => void } };
  runInNewContext(`(${installBridgeCorrections.toString()})()`, { window: { __netLag: state, __wildshard: { world: { player: { position: { x: 25, y: 6, z: 23 } } } }, __workerClientBot: () => ({ client: bot, end }) } });
  expect(end).toHaveBeenCalledOnce();
  bot.rendered(); expect(state.bridgeFault?.ready).toBe(false);
  main.rendered(); expect(Client.prototype.rendered).toBe(original);
  const fault = state.bridgeFault; expect(fault?.ready).toBe(true);
  if (fault === undefined) throw new Error('Missing hook');
  try {
    for (const [index, sink] of [0.3, 1].entries()) {
      fault.armed = sink;
      const discarded = { tick: 2 + index * 2, owner: new Float64Array([0, 6, 0]) };
      const selected = { tick: discarded.tick + 1, owner: new Float64Array([0, 6, 0]) };
      main.receive(discarded); main.receive(selected);
      expect(selected.owner[1]).toBe(6); expect(discarded.owner[1]).toBe(6);
      expect(main.latest.owner[1]).toBeCloseTo(6 - sink);
      expect(fault.confirmed).toHaveLength(index);
      for (const fn of main.corrections) fn({ tick: selected.tick, offset: sink });
      expect(fault.armed).toBe(0);
    }
    expect(fault.confirmed.map(row => row.sink)).toEqual([0.3, 1]);
  } finally { fault.cleanup(); }
  expect(main.frames.size).toBe(0); expect(main.corrections.size).toBe(0);
});
