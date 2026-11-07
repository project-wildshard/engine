import { expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { realGc } from '../../../test/engine/realGc';
import { memoryAttribution } from '../../../shared/engine/core/memoryAttribution';
import { VoicePool, type Family } from './Voices';

class Pcm implements AudioBuffer {
  readonly duration: number;
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array<ArrayBuffer>[];
  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels; this.length = length; this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    const data = this.channels[channel]; if (data === undefined) throw new Error('Missing PCM channel'); return data;
  }
  copyFromChannel(destination: Float32Array<ArrayBuffer>, channel: number, offset = 0): void {
    destination.set(this.getChannelData(channel).subarray(offset, offset + destination.length));
  }
  copyToChannel(source: Float32Array<ArrayBuffer>, channel: number, offset = 0): void {
    this.getChannelData(channel).set(source, offset);
  }
}
function fixture() {
  const owner = new Scope('voice-pool-fixture');
  const context = legacyDouble<BaseAudioContext>({ sampleRate: 48000, createBuffer: (channels, frames, rate) => new Pcm(channels, frames, rate) });
  const pool = withOwner(owner, () => new VoicePool({ ctx: context, sfx: legacyDouble<GainNode>({}), ready: true }));
  return { owner, pool };
}
const family = (value: number, frames = 16): Family => ({ n: 1, ch: 1, gen: () => new Float32Array(frames).fill(value) });

test('procedural PCM reports its original channels once under the captured owner', () => {
  const f = fixture(), consumer = new Scope('voice-reader');
  const rows = () => memoryAttribution.snapshot().allocations.filter(row => row.asset === 'audio/procedural/fixture-observed/0');
  try {
    f.pool.register({ 'fixture-observed': { n: 1, ch: 2, half: true,
      gen: (rate, _seed, channel) => new Float32Array(rate / 1000).fill((channel + 1) / 4) } });
    const buffer = withOwner(consumer, () => f.pool.buffer('fixture-observed'));
    if (buffer === undefined) throw new Error('Missing procedural buffer');
    expect([buffer.length, buffer.numberOfChannels, buffer.sampleRate]).toEqual([24, 2, 24000]);
    expect(buffer.getChannelData(0).every(sample => sample === 0.25)).toBe(true);
    expect(buffer.getChannelData(1).every(sample => sample === 0.5)).toBe(true);
    const allocations = rows();
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ domain: 'ram', kind: 'audio-buffer', bytes: 192, precision: 'exact', owner: f.owner.name });
    expect(f.pool.buffer('fixture-observed')).toBe(buffer);
    expect(rows()).toEqual(allocations);
  } finally { consumer.dispose(); f.owner.dispose(); }
});

test('a replacement family renders its own PCM and old removal cannot evict the successor', () => {
  const f = fixture();
  try {
    const removeOld = f.pool.register({ 'fixture/voice': family(0.25) });
    const old = f.pool.buffer('fixture/voice');
    expect(old?.getChannelData(0)[0]).toBe(0.25);
    expect(f.pool.buffer('fixture/voice')).toBe(old);
    const remove = f.pool.register({ 'fixture/voice': family(0.75) });
    const current = f.pool.buffer('fixture/voice');
    expect(current).not.toBe(old); expect(current?.getChannelData(0)[0]).toBe(0.75);
    removeOld(); expect(f.pool.buffer('fixture/voice')).toBe(current);
    remove(); expect(f.pool.buffer('fixture/voice')).toBeUndefined();
    expect(f.pool.rendered).not.toHaveProperty('fixture/voice');
  } finally { f.owner.dispose(); }
});

test('removing an override restores the original default samples without changing another family', () => {
  const f = fixture();
  try {
    const original = f.pool.buffer('hurt'), other = f.pool.buffer('death');
    if (original === undefined) throw new Error('Missing default voice');
    const remove = f.pool.register({ hurt: family(0.125) });
    const override = f.pool.buffer('hurt');
    expect(override?.length).toBe(16); expect(override?.getChannelData(0)[0]).toBe(0.125);
    remove();
    const restored = f.pool.buffer('hurt');
    if (restored === undefined) throw new Error('Missing restored voice');
    expect([restored.length, restored.sampleRate, restored.numberOfChannels]).toEqual([original.length, original.sampleRate, original.numberOfChannels]);
    expect(restored.getChannelData(0).every((sample, index) => Object.is(sample, original.getChannelData(0)[index]))).toBe(true);
    expect(f.pool.buffer('death')).toBe(other);
  } finally { f.owner.dispose(); }
});

test('a replacement drops only its obsolete warm jobs and renders the new channel roster', () => {
  const f = fixture(), idle: (() => void)[] = [], calls: string[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    requestIdleCallback: (run: () => void): number => idle.push(run),
  } });
  const make = (name: string, channels: 1 | 2, variants: number): Family => ({ n: variants, ch: channels,
    gen: (_rate, seed, channel) => { calls.push(`${name}/${seed}/${channel}`); return new Float32Array([seed, channel]); } });
  try {
    f.pool.register({ voice: make('old', 2, 2), other: make('other', 1, 1) });
    f.pool.prewarm(['voice', 'other']);
    const first = idle.shift(); if (first === undefined) throw new Error('Missing warm job'); first();
    expect(calls).toEqual(['old/1/0']);
    f.pool.register({ voice: make('new', 1, 1) }); f.pool.prewarm(['voice']);
    // Exhaust only this finite fixture queue; a stale job must not generate
    // an undeclared extra variant under the successor's smaller roster.
    for (let turn = 0; turn < 10; turn++) { const run = idle.shift(); if (run === undefined) break; run(); }
    expect(idle).toHaveLength(0);
    expect(calls).toEqual(['old/1/0', 'other/1/0', 'new/1/0']);
    expect(f.pool.buffer('voice')?.numberOfChannels).toBe(1);
    expect(f.pool.has('voice')).toBe(true); expect(f.pool.has('other')).toBe(true);
  } finally {
    f.owner.dispose();
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', previous);
  }
});

const retirement = 'retired scoped voice PCM collects while its pool and unrelated family stay live';
test(retirement, async () => {
  await realGc('src/client/engine/audio/voice-pool-lifetime.test.ts', retirement, async collect => {
    const f = fixture(), registration = new Scope('voice-registration');
    try {
      const other = family(0.5); f.pool.register({ other }, f.owner);
      const live = f.pool.buffer('other');
      const retired = (() => {
        f.pool.register({ retired: family(0.25, 256 * 1024) }, registration);
        const buffer = f.pool.buffer('retired');
        if (buffer === undefined) throw new Error('Missing registered voice');
        return { buffer: new WeakRef(buffer), backing: new WeakRef(buffer.getChannelData(0).buffer) };
      })();
      registration.dispose();
      await collect(retired.buffer); await collect(retired.backing);
      expect(f.pool.buffer('retired')).toBeUndefined(); expect(f.pool.buffer('other')).toBe(live);
      expect(f.pool.rendered).toEqual({ other: 1 });
    } finally { registration.dispose(); f.owner.dispose(); }
  });
});

test('pool retirement cancels its idle handle and a late callback cannot render or schedule', () => {
  const f = fixture(), idle = new Map<number, () => void>(), cancelled: number[] = [];
  let sequence = 0, rendered = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    requestIdleCallback: (run: () => void): number => { const id = ++sequence; idle.set(id, run); return id; },
    cancelIdleCallback: (id: number): void => { cancelled.push(id); idle.delete(id); },
  } });
  try {
    f.pool.register({ queued: { n: 2, ch: 1, gen: () => { rendered++; return new Float32Array(16); } } });
    f.pool.prewarm(['queued']);
    const late = idle.get(1); if (late === undefined) throw new Error('Missing queued callback');
    f.owner.dispose();
    expect(cancelled).toEqual([1]); expect(idle.size).toBe(0);
    late(); f.pool.prewarm(['hurt']);
    expect(rendered).toBe(0); expect(idle.size).toBe(0); expect(sequence).toBe(1);
    expect(f.pool.buffer('hurt')).toBeUndefined(); expect(f.pool.play('hurt')).toBeUndefined();
    expect(f.pool.sample([{ buffer: new Pcm(1, 16, 48000), offset: 0, duration: 16 / 48000 }])).toBeUndefined();
    f.pool.register({ late: family(0.5) }); expect(f.pool.buffer('late')).toBeUndefined();
    expect(f.pool.has('hurt')).toBe(false); expect(f.pool.rendering('hurt')).toBe(false);
    expect(f.pool.rendered).toEqual({});
  } finally {
    f.owner.dispose();
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', previous);
  }
});

test('sliced ancestor retirement blocks new PCM before the child cleanup runs', () => {
  const f = fixture();
  f.owner.onDispose(() => { /* First sliced cleanup, before the VoicePool child. */ });
  const steps = f.owner.disposeSteps();
  try {
    expect(steps.next().done).toBe(false);
    expect(f.pool.buffer('hurt')).toBeUndefined();
    expect(f.pool.play('hurt')).toBeUndefined(); expect(f.pool.has('hurt')).toBe(false);
    f.pool.prewarm(['hurt']);
    expect(f.pool.rendered).toEqual({});
  } finally { for (const _step of steps) { /* Drain the original sliced retirement. */ } }
});

const poolRetirement = 'a retained retired pool releases default and private PCM backing';
test(poolRetirement, async () => {
  await realGc('src/client/engine/audio/voice-pool-lifetime.test.ts', poolRetirement, async collect => {
    const f = fixture(), other = fixture();
    try {
      const live = other.pool.buffer('hurt');
      const retired = (() => {
        f.pool.register({ private: family(0.25, 256 * 1024) });
        const custom = f.pool.buffer('private'), builtIn = f.pool.buffer('noise-white');
        if (custom === undefined || builtIn === undefined) throw new Error('Missing pooled PCM');
        return [new WeakRef(custom), new WeakRef(custom.getChannelData(0).buffer), new WeakRef(builtIn), new WeakRef(builtIn.getChannelData(0).buffer)];
      })();
      f.owner.dispose();
      for (const ref of retired) await collect(ref);
      expect(f.pool.rendered).toEqual({}); expect(f.pool.buffer('noise-white')).toBeUndefined();
      expect(other.pool.buffer('hurt')).toBe(live);
    } finally { f.owner.dispose(); other.owner.dispose(); }
  });
});
