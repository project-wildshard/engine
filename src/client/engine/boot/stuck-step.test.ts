import { expect, test } from 'vitest';
import { progressOfCard, stuckContext, stuckMessage, watchStuckStep, type StuckStepPorts } from './stuckStep';

/** A fake clock and timer: `tick(ms)` advances the clock and runs the repeating timer once a second. */
function harness(progress: () => { step: string; signature: string }) {
  let now = 0, run: (() => void) | null = null;
  const stalls: [string, number][] = [];
  const ports: StuckStepPorts = {
    progress, now: () => now,
    every: (_ms, fn) => { run = fn; return () => { run = null; }; },
    stalled: (step, ms) => { stalls.push([step, ms]); },
  };
  const tick = (ms: number): void => { for (let t = 0; t < ms; t += 1000) { now += 1000; run?.(); } };
  return { ports, tick, stalls, running: () => run !== null };
}
const never = new Promise<never>(() => { /* a start that hangs */ });

test('a start that hangs on one step is named once after the bound', () => {
  const h = harness(() => ({ step: 'world.props', signature: 'world.props|40|1000' }));
  watchStuckStep(never, h.ports, 60_000);
  h.tick(59_000); expect(h.stalls).toEqual([]);
  h.tick(1000); expect(h.stalls).toEqual([['world.props', 60_000]]);
  h.tick(120_000); expect(h.stalls).toHaveLength(1);
  expect(h.running()).toBe(false);
});

test('progress (a new step, setup share or bytes) restarts the bound', () => {
  let bytes = 0;
  const h = harness(() => ({ step: 'download', signature: `download|0|${bytes}` }));
  watchStuckStep(never, h.ports, 60_000);
  for (let i = 0; i < 10; i++) { h.tick(30_000); bytes += 1; }
  expect(h.stalls).toEqual([]);
  // the last change is read on the next second; the bound runs from there
  h.tick(60_000); expect(h.stalls).toEqual([]);
  h.tick(1000); expect(h.stalls).toEqual([['download', 60_000]]);
});

test('a start that settles, resolved or thrown, ends the watch without a stall', async () => {
  for (const started of [Promise.resolve(), Promise.reject(new Error('refused'))]) {
    const h = harness(() => ({ step: 'gap', signature: 'gap' }));
    watchStuckStep(started, h.ports, 60_000);
    await started.catch(() => undefined); await Promise.resolve();
    h.tick(120_000);
    expect(h.stalls).toEqual([]);
    expect(h.running()).toBe(false);
  }
});

test('the card gives the step and a signature of its progress; no card is still the modules', () => {
  expect(progressOfCard(null)).toEqual({ step: 'modules', signature: 'modules' });
  const card = { dataset: { step: 'world.props', setup: '40', readBytes: '1000', spawnFilesDone: '3', streamedBytes: '4096' } };
  expect(progressOfCard(card)).toEqual({ step: 'world.props', signature: 'world.props|40|1000|3|4096|', player: false });
  expect(progressOfCard({ dataset: { step: 'gap', ready: 'true' } }).player).toBe(true);
});

test('a boot whose PLAY is up waits on the player: held for minutes it is never stuck, and nothing is reported', () => {
  // Jake, 2026-11-10 (iPhone, Developer ▸ Hold at loading screen): the card held at 100% with PLAY up, and a minute later
  // the fatal modal named step "gap" and sent a report. The hold is the player's; only a real hang may trip the bound.
  const dataset: Record<string, string | undefined> = { step: 'gap', setup: '100', readBytes: '5000', ready: 'true' };
  const h = harness(() => progressOfCard({ dataset }));
  watchStuckStep(never, h.ports, 60_000);
  h.tick(300_000);
  expect(h.stalls).toEqual([]);
  expect(h.running()).toBe(true);
  // loading goes on (PLAY tapped) and then hangs: the bound starts from the end of the hold, not its start
  delete dataset['ready'];
  h.tick(59_000); expect(h.stalls).toEqual([]);
  h.tick(1000); expect(h.stalls).toEqual([['gap', 60_000]]);
});

test('the same card without PLAY up, unmoved for the bound, is still a stall', () => {
  const dataset: Record<string, string> = { step: 'gap', setup: '100', readBytes: '5000' };
  const h = harness(() => progressOfCard({ dataset }));
  watchStuckStep(never, h.ports, 60_000);
  h.tick(59_000); expect(h.stalls).toEqual([]);
  h.tick(1000); expect(h.stalls).toEqual([['gap', 60_000]]);
});

test('a wait for a seat in a full world is no hang, and the watch stands once it ends', () => {
  const dataset: Record<string, string> = { step: 'server', seatWait: '0' };
  const h = harness(() => progressOfCard({ dataset }));
  watchStuckStep(never, h.ports, 60_000);
  for (let s = 0; s < 180; s += 5) { h.tick(5000); dataset['seatWait'] = String(s); }
  expect(h.stalls).toEqual([]);
  h.tick(61_000); expect(h.stalls).toEqual([['server', 60_000]]);
});

test('a part streaming for minutes before its first member verifies is progress, not a stall', () => {
  // the spawn download publishes streamed bytes as a part's chunks arrive; its verified bytes and files stay put
  const dataset: Record<string, string> = { step: 'modules', setup: '0', readBytes: '0', spawnFilesDone: '0', streamedBytes: '0' };
  const h = harness(() => progressOfCard({ dataset }));
  watchStuckStep(never, h.ports, 60_000);
  for (let s = 0; s < 180; s += 10) { h.tick(10_000); dataset['streamedBytes'] = String((s + 10) * 65_536); }
  expect(h.stalls).toEqual([]);
  h.tick(61_000); expect(h.stalls).toEqual([['modules', 60_000]]);
});

test('the fatal line names the step, for a hang and for a throw', () => {
  expect(stuckMessage('world.props', { stuckMs: 60_400 })).toBe('The game stopped loading at step "world.props" (no progress for 60 s)');
  expect(stuckMessage('admission.download', { error: new TypeError('Load failed') })).toBe('The game failed to start at step "admission.download" (TypeError: Load failed)');
});

test('S4: a stalled card reports its step, last 8 rows, files, bytes, link and visibility', () => {
  const rows = Array.from({ length: 11 }, (_, i) => `row ${String(i + 1)}`);
  const card = { dataset: { step: 'world.props', spawnFilesDone: '41', spawnFilesTotal: '89', readBytes: '18300000', streamedBytes: '0', setup: '62' }, rows };
  expect(stuckContext(card, { connection: '4g', visibility: 'visible' })).toEqual({
    step: 'world.props', rows: rows.slice(-8), filesDone: 41, filesTotal: 89, readBytes: 18_300_000, streamedBytes: 0, setup: 62,
    connection: '4g', visibility: 'visible',
  });
});

test('S4: no card and no browser facts still give a complete, honest context', () => {
  expect(stuckContext(null)).toEqual({ step: 'modules', rows: [], filesDone: null, filesTotal: null, readBytes: null, streamedBytes: null,
    setup: null, connection: 'unknown', visibility: 'unknown' });
  expect(stuckContext({ dataset: { step: 'gap', readBytes: 'NaN' } })['readBytes']).toBeNull();
});

test('S4: rows lose every query and fragment before they leave the page', () => {
  const rows = ['parts/driftwood-0.bin?token=secret&id=7 1.2 MB', 'world#frag done'];
  expect(stuckContext({ dataset: { step: 'download' }, rows })['rows']).toEqual(['parts/driftwood-0.bin 1.2 MB', 'world done']);
});
