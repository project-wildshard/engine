// meta IPHONE13-DRIFTWOOD DW3 (mini-driftwood13d): `debug.audioWarmWorker` moves the prewarm's renders off the main thread.
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { renderVoiceWork, type Family } from './voiceFamilies';
import { AUDIO_WARM_WORKER_DEFAULT, audioWarmWorker, resetAudioWarmWorker, VoicePool, type VoiceRenderPort } from './Voices';

class Pcm {
  readonly length: number; readonly sampleRate: number; readonly numberOfChannels: number; readonly duration: number;
  private readonly channels: Float32Array[];
  constructor(channels: number, length: number, rate: number) {
    this.numberOfChannels = channels; this.length = length; this.sampleRate = rate; this.duration = length / rate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array { const data = this.channels[channel]; if (data === undefined) throw new Error('no channel'); return data; }
}
interface Job { id: number; work: unknown; sr: number; seed: number; ch: number }
/** a worker that answers each job on the next task, with `answer` (data, or an error reply) */
function fakePort(answer: (job: Job) => { data?: Float32Array; error?: string }) {
  const jobs: Job[] = [], listeners = new Map<string, (event: unknown) => void>();
  const port = {
    postMessage: (job: Job) => { jobs.push(job); setTimeout(() => { listeners.get('message')?.({ data: { id: job.id, ...answer(job) } }); }, 0); },
    terminate: () => undefined,
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.set(type, listener); },
    removeEventListener: (type: string) => { listeners.delete(type); },
  };
  return { jobs, port: port as unknown as VoiceRenderPort };
}
function pool() {
  const owner = new Scope('audio-warm-worker');
  const ctx = legacyDouble<BaseAudioContext>({ sampleRate: 48000, createBuffer: (channels, frames, rate) => new Pcm(channels, frames, rate) as unknown as AudioBuffer });
  return { owner, voices: withOwner(owner, () => new VoicePool({ ctx, sfx: legacyDouble<GainNode>({}), ready: true })) };
}
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 150); });
afterEach(() => { resetAudioWarmWorker(); });
// the pool's idle slices look for requestIdleCallback on window: a window without it takes the timer, as iOS Safari does
const globals = globalThis as unknown as Record<string, unknown>;
let ownWindow = false;
beforeAll(() => { if (globals['window'] === undefined) { globals['window'] = {}; ownWindow = true; } });
afterAll(() => { if (ownWindow) delete globals['window']; });

test('with the slot on, every prewarm slice of a family with work renders in the worker, none on the main thread', async () => {
  expect(AUDIO_WARM_WORKER_DEFAULT).toBe(false);
  let mainRenders = 0;
  const family: Family = { n: 2, ch: 2, gen: () => { mainRenders++; return new Float32Array(8); }, work: { kind: 'family', name: 'noise-white' } };
  const fake = fakePort(job => ({ data: new Float32Array(8).fill(job.seed * 10 + job.ch) }));
  resetAudioWarmWorker(true, () => fake.port);
  const f = pool();
  try {
    f.voices.register({ 'fixture-warm': family });
    f.voices.prewarm(['fixture-warm']);
    await settle();
    expect(fake.jobs.map(job => [job.seed, job.ch, job.sr])).toEqual([[1, 0, 48000], [1, 1, 48000], [2, 0, 48000], [2, 1, 48000]]);
    expect(f.voices.has('fixture-warm')).toBe(true);
    expect(mainRenders).toBe(0);
    expect(f.voices.buffer('fixture-warm')?.getChannelData(1)[0]).toBe(11);
  } finally { f.owner.dispose(); }
});

test('a failed worker render falls back to the main thread, and so does the rest of the prewarm', async () => {
  let mainRenders = 0;
  const family: Family = { n: 2, ch: 1, gen: () => { mainRenders++; return new Float32Array(8).fill(0.5); }, work: { kind: 'family', name: 'noise-white' } };
  const fake = fakePort(() => ({ error: 'boom' }));
  resetAudioWarmWorker(true, () => fake.port);
  const f = pool();
  try {
    f.voices.register({ 'fixture-fail': family });
    f.voices.prewarm(['fixture-fail']);
    await settle();
    expect(fake.jobs).toHaveLength(1);
    expect(mainRenders).toBe(2);
    expect(f.voices.has('fixture-fail')).toBe(true);
  } finally { f.owner.dispose(); }
});

test('off by default: the prewarm renders on the main thread and no worker starts', async () => {
  let started = 0, mainRenders = 0;
  resetAudioWarmWorker(false, () => { started++; return null; });
  const f = pool();
  try {
    f.voices.register({ 'fixture-off': { n: 1, ch: 1, gen: () => { mainRenders++; return new Float32Array(4); }, work: { kind: 'family', name: 'noise-white' } } });
    f.voices.prewarm(['fixture-off']);
    await settle();
    expect([started, mainRenders]).toEqual([0, 1]);
  } finally { f.owner.dispose(); }
});

test('the worker renders the same samples as the main thread', () => {
  expect([...renderVoiceWork({ kind: 'impact', material: 'wood' }, 24000, 2, 0).subarray(0, 64)])
    .toEqual([...renderVoiceWork({ kind: 'impact', material: 'wood' }, 24000, 2, 0).subarray(0, 64)]);
  expect(renderVoiceWork({ kind: 'family', name: 'ir-cave' }, 48000, 1, 1).length).toBeGreaterThan(0);
  expect(() => renderVoiceWork({ kind: 'family', name: 'no-such' }, 48000, 1, 0)).toThrow('No voice family no-such');
});

test('unset, a phone renders in the worker (any graphics, DF8) and a desktop does not; a saved pick wins (DW3)', () => {
  expect(audioWarmWorker(null, true)).toBe(true);
  expect(audioWarmWorker(undefined, false)).toBe(false);
  expect(audioWarmWorker(null)).toBe(AUDIO_WARM_WORKER_DEFAULT);
  expect(audioWarmWorker(false, true)).toBe(false);
  expect(audioWarmWorker(true, false)).toBe(true);
  expect(audioWarmWorker('on', true)).toBe(true);
});

/** a worker whose script has not run yet: jobs queue (as a real Worker queues messages) until `boot`, then each is answered */
function slowPort() {
  const jobs: Job[] = [], listeners = new Map<string, (event: unknown) => void>();
  let up = false;
  const answer = (job: Job): void => { listeners.get('message')?.({ data: { id: job.id, data: new Float32Array(8).fill(job.seed) } }); };
  const port = {
    postMessage: (job: Job) => { jobs.push(job); if (up) setTimeout(() => { answer(job); }, 0); },
    terminate: () => undefined,
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.set(type, listener); },
    removeEventListener: (type: string) => { listeners.delete(type); },
  };
  return { jobs, port: port as unknown as VoiceRenderPort,
    boot: () => { up = true; listeners.get('message')?.({ data: { ready: true } }); for (const job of jobs) answer(job); },
    fail: () => { listeners.get('error')?.({ preventDefault: () => undefined }); } };
}

test('a worker slow to boot (a cold first load) is waited for: no prewarm slice renders on the main thread past 5 s (DF8)', () => {
  vi.useFakeTimers();
  let mainRenders = 0;
  const family: Family = { n: 2, ch: 1, gen: () => { mainRenders++; return new Float32Array(8); }, work: { kind: 'family', name: 'noise-white' } };
  const slow = slowPort();
  resetAudioWarmWorker(true, () => slow.port);
  const f = pool();
  try {
    f.voices.register({ 'fixture-cold': family });
    f.voices.prewarm(['fixture-cold']);
    vi.advanceTimersByTime(20_000);
    expect([mainRenders, slow.jobs.length, f.voices.warmWorker.state]).toEqual([0, 1, 'booting']);
    slow.boot();
    vi.advanceTimersByTime(1000);
    expect([mainRenders, slow.jobs.length, f.voices.has('fixture-cold')]).toEqual([0, 2, true]);
    expect(f.voices.warmWorker).toMatchObject({ on: true, state: 'ready', spawns: 1, renders: 2, reason: null });
  } finally { f.owner.dispose(); vi.useRealTimers(); }
});

test('a worker whose script fails to load is started once more before the prewarm falls back to the main thread (DF8)', () => {
  vi.useFakeTimers();
  let mainRenders = 0;
  const family: Family = { n: 2, ch: 1, gen: () => { mainRenders++; return new Float32Array(8); }, work: { kind: 'family', name: 'noise-white' } };
  const first = slowPort(), second = slowPort(), ports = [first, second];
  resetAudioWarmWorker(true, () => ports.shift()?.port ?? null);
  const f = pool();
  try {
    f.voices.register({ 'fixture-retry': family });
    f.voices.prewarm(['fixture-retry']);
    vi.advanceTimersByTime(100);
    first.fail();
    expect([mainRenders, second.jobs.length]).toEqual([0, 1]);
    second.boot();
    vi.advanceTimersByTime(1000);
    expect([mainRenders, f.voices.has('fixture-retry')]).toEqual([0, true]);
    expect(f.voices.warmWorker).toMatchObject({ state: 'ready', spawns: 2, reason: 'worker failed' });
  } finally { f.owner.dispose(); vi.useRealTimers(); }
});

test('a second boot failure leaves the prewarm on the main thread for the page (DF8)', () => {
  vi.useFakeTimers();
  let mainRenders = 0;
  const family: Family = { n: 2, ch: 1, gen: () => { mainRenders++; return new Float32Array(8); }, work: { kind: 'family', name: 'noise-white' } };
  const first = slowPort(), second = slowPort(), ports = [first, second];
  resetAudioWarmWorker(true, () => ports.shift()?.port ?? null);
  const f = pool();
  try {
    f.voices.register({ 'fixture-twice': family });
    f.voices.prewarm(['fixture-twice']);
    vi.advanceTimersByTime(100);
    first.fail();
    vi.advanceTimersByTime(61_000);
    vi.advanceTimersByTime(1000);
    expect([mainRenders, f.voices.has('fixture-twice')]).toEqual([2, true]);
    expect(f.voices.warmWorker).toMatchObject({ state: 'off', spawns: 2, reason: 'boot timeout' });
  } finally { f.owner.dispose(); vi.useRealTimers(); }
});
