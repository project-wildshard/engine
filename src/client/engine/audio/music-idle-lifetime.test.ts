import { beforeAll, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import type { Audio } from './Audio';
import { Music } from './Music';
import { installScore, score, type Arrangement, type Score } from './score/score';

// The sequencer is a lifetime double; its content must be explicit too.
const TEST_SCORE: Score = {
  arrangements: { theme: { name: 'theme', driven: false, segments: [
    { id: 'idle-fixture', bpm: 96, beats: 4, chords: [{ t: 0, chord: 'tonic' }], notes: {} },
  ] } },
  chords: { tonic: [60, 64, 67] }, chordRoot: { tonic: 60 },
  dorianOf: {}, dorianPitch: n => n,
  stings: { pickup: [], death: { chords: ['tonic', 'tonic'], bass: [] }, chunk: { chord: 'tonic', bell: [] } },
};
beforeAll(() => { installScore(TEST_SCORE); });

function fixture() {
  const owner = new Scope('music-idle-fixture');
  const music = withOwner(owner, () => new Music(legacyDouble<Audio>({})));
  const param: AudioParam = legacyDouble<AudioParam>({
    cancelScheduledValues: () => param, setValueAtTime: () => param,
  });
  const gain = legacyDouble<GainNode>({ gain: param });
  const warm = vi.fn<(arrangement: Arrangement) => void>();
  const engine = legacyDouble<Music['engine']>({
    seq: gain, synthMix: gain, begin: () => undefined, pump: () => undefined,
    currentSpb: () => 1, warm,
  });
  const events=new EventTarget();
  vi.spyOn(music, 'ctx', 'get').mockReturnValue(legacyDouble<AudioContext>({ currentTime: 0,state:'running',
    addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events) }));
  vi.spyOn(music, 'engine', 'get').mockReturnValue(engine);
  const idle: (() => void)[] = [], cancel = vi.fn<(id: number) => void>();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    requestIdleCallback: (run: () => void): number => idle.push(run), cancelIdleCallback: cancel,
  } });
  const callback = (): (() => void) => {
    const run = idle.shift(); if (run === undefined) throw new Error('Missing music warm-up'); return run;
  };
  const dispose = (): void => {
    owner.dispose(); vi.restoreAllMocks();
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', previousWindow);
  };
  return { owner, music, warm, cancel, callback, dispose };
}

test('retiring music cancels its idle PCM warm-up and a raced callback stays inert', () => {
  const f = fixture();
  try {
    f.music.play('theme');
    const raced = f.callback();
    expect(f.warm).not.toHaveBeenCalled();
    f.owner.dispose();
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(1);
    raced();
    expect(f.warm).not.toHaveBeenCalled();
  } finally { f.dispose(); }
});

test('live music warms the original arrangement once and forgets completed idle work', () => {
  const f = fixture();
  try {
    f.music.play('theme'); f.callback()();
    expect(f.warm).toHaveBeenCalledExactlyOnceWith(score().arrangements['theme']);
    f.owner.dispose();
    expect(f.cancel).not.toHaveBeenCalled();
  } finally { f.dispose(); }
});

test('a sliced ancestor retirement makes a raced warm-up inert before child cleanup', () => {
  const f = fixture();
  f.music.play('theme');
  const raced = f.callback();
  f.owner.onDispose(() => { /* Yield before the Music child is cleaned. */ });
  const steps = f.owner.disposeSteps();
  try {
    expect(steps.next().done).toBe(false);
    expect(f.cancel).not.toHaveBeenCalled();
    raced();
    expect(f.warm).not.toHaveBeenCalled();
  } finally {
    for (const _step of steps) { /* Complete the finite sliced retirement. */ }
    f.dispose();
  }
});
