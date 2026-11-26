import { expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the exact serialized browser hook in isolation.
import { runInNewContext } from 'node:vm';
import { BOOST_SPEED, WEBKIT_PACING, b1Verdict, b3Verdict, boostBack, bridgeVerdict, installBridgeCorrections, proofVerdict } from '../src/scripts/net-lag-verdict.mjs';

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
  // ZE23: the error card, the glitch chip or a faulted system (src/scripts/proof-faults.mjs) fails a timing run too
  expect(proofVerdict({ ...timing, errors: ['system "grid.live" faulted: TypeError: boom'] }, 'timing').ok).toBe(false);
  expect(proofVerdict({ b4: bridgeVerdict(crossing), error: 'page failed' }, 'correctness').ok).toBe(false);
  expect(proofVerdict({ b4: bridgeVerdict(crossing), errors: ['uncaught page error'] }, 'correctness').ok).toBe(false);
});

test.each(['live', 'render'])('bridge faults intercept the actual %s reconciliation without changing wire frames', mode => {
  interface Frame { tick: number; owner: Float64Array }
  class Client {
    latest: Frame = { tick: 1, owner: new Float64Array([0, 6, 0]) };
    corrections = new Set<(row: { tick: number; offset: number }) => void>();
    owner(frame: { owner: Float64Array }): { py: number } { return { py: frame.owner[1] ?? 0 }; }
    onCorrection(fn: (row: { tick: number; offset: number }) => void): () => void { this.corrections.add(fn); return () => { this.corrections.delete(fn); }; }
  }
  const main = new Client(), unavailableBot = vi.fn(() => { throw new Error('A second client belongs to a server in this page'); });
  const original = vi.fn((_seq: number, owner: Float64Array, tick: number, _ride: unknown) => {
    const sink = 6 - (owner[1] ?? 0);
    if (sink > 0) for (const fn of main.corrections) fn({ tick, offset: sink });
    return sink > 0;
  });
  const predictor = { reconcile: original };
  const state = { slowMs: 60, bridgeFault: undefined as undefined | { ready: boolean; armed: number; confirmed: { sink: number; tick: number }[]; cleanup: () => void } };
  runInNewContext(`(${installBridgeCorrections.toString()})()`, { window: { __netLag: state, __wildshard: { world: { player: { position: { x: 25, y: 6, z: 23 } } } }, __workerClientNet: () => ({ client: main, predictor }), __workerClientBot: unavailableBot } });
  expect(unavailableBot).not.toHaveBeenCalled();
  const fault = state.bridgeFault; expect(fault?.ready).toBe(true);
  if (fault === undefined) throw new Error('Missing hook');
  try {
    for (const [index, sink] of [0.3, 1].entries()) {
      fault.armed = sink;
      const discarded = { tick: 2 + index * 2, owner: new Float64Array([0, 6, 0]) };
      const selected = { tick: discarded.tick + 1, owner: new Float64Array([0, 6, 0]) };
      main.latest = discarded;
      // Live device input reconciles synchronously on receipt, before later frame listeners.
      if (mode === 'live') predictor.reconcile(discarded.tick, discarded.owner, discarded.tick, null);
      main.latest = selected;
      predictor.reconcile(selected.tick, selected.owner, selected.tick, null);
      expect(main.latest).toBe(selected);
      expect(selected.owner[1]).toBe(6); expect(discarded.owner[1]).toBe(6);
      expect(fault.confirmed).toHaveLength(index + 1);
      expect(fault.confirmed[index]?.tick).toBe(mode === 'live' ? discarded.tick : selected.tick);
      expect(fault.armed).toBe(0);
    }
    expect(fault.confirmed.map(row => row.sink)).toEqual([0.3, 1]);
  } finally { fault.cleanup(); }
  expect(predictor.reconcile).toBe(original); expect(main.corrections.size).toBe(0);
});

test('B3 gives B4\'s forced frames the same 10 s to settle that it gives entry', () => {
  // NET-LAG NL17 (staging v0.1.50, Driftwood): jitter 2 to 6 ms on the wire, 120 to 134 ms while B4 forced 60 ms frames,
  // delay 175 ms; it was back to 70 ms 11 s after the bridge. The proof's own stall is not the link's.
  const delays = [{ t: 5_000, delay: 110 }, { t: 12_000, delay: 70 }, { t: 41_000, delay: 175 }, { t: 58_000, delay: 117 }, { t: 70_000, delay: 70 }];
  expect(b3Verdict(delays, 0, 0)).toMatchObject({ delayMaxAfter10s: 175, fromSeconds: 10, ok: false });
  expect(b3Verdict(delays, 0, 0, 48_000)).toMatchObject({ delayMaxAfter10s: 117, fromSeconds: 58, ok: true });
  // a real rise after the settle still fails, and so does a held frame or no sample at all
  expect(b3Verdict([...delays, { t: 80_000, delay: 121 }], 0, 0, 48_000).ok).toBe(false);
  expect(b3Verdict(delays, 2, 3, 48_000)).toMatchObject({ held: 1, ok: false });
  expect(b3Verdict([{ t: 5_000, delay: 80 }], 0, 0).ok).toBe(false);
});

test('B1 judges every line in Chromium, and only frames over 50 ms in headless WebKit (NL16)', () => {
  // staging v0.1.50, Nine desktop, load 6: WebKit p99 21 and 22 ms with 3 and 8 frames of 30 to 40 ms, none over 50 ms
  const paced = [{ over2x: 0, over50: 0, p99: 21 }, { over2x: 3, over50: 0, p99: 19 }];
  expect(b1Verdict('chromium', paced, 1000 / 60)).toMatchObject({ over2x: 3, over50: 0, p99: 21, ok: false });
  expect(b1Verdict('webkit', paced, 1000 / 60)).toMatchObject({ over2x: 3, over50: 0, p99: 21, ok: true, pacing: WEBKIT_PACING });
  // a frame over 50 ms is real work in either engine
  expect(b1Verdict('webkit', [...paced, { over2x: 1, over50: 1, p99: 19 }], 1000 / 60).ok).toBe(false);
  expect(b1Verdict('chromium', [{ over2x: 0, over50: 0, p99: 16.8 }], 1000 / 60).ok).toBe(true);
  expect(b1Verdict('chromium', [{ over2x: 0, over50: 0, p99: 33.4 }], 1000 / 30)).not.toHaveProperty('pacing');
});

test('the boost goes back no further than the walk and sprint went (NL15, NL17)', () => {
  // staging v0.1.50, Nalati: the walk went 89 m and the sprint stuck after 3 m; 12 s back at 14 m/s left the cell
  expect(boostBack(20, 92)).toBe(5);
  expect(boostBack(20, 220)).toBe(12);
  expect(boostBack(20, 0)).toBe(0);
  expect(boostBack(20, 92) * BOOST_SPEED).toBeLessThan(92);
});
