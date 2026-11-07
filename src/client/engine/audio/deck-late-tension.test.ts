import { expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { Deck, type SlotAudio } from './Stems';

function fixture() {
  const owner = new Scope('late-tension'), events = new EventTarget();
  const sources: AudioBufferSourceNode[] = [], starts: number[][] = [], stops: ReturnType<typeof vi.fn>[] = [];
  let now = 0;
  const gain = (): GainNode => {
    const param: AudioParam = legacyDouble<AudioParam>({ value: 0, setValueAtTime: () => param,
      linearRampToValueAtTime: () => param, cancelScheduledValues: () => param, cancelAndHoldAtTime: () => param });
    return legacyDouble<GainNode>({ gain: param, connect: () => gain(), disconnect: () => undefined });
  };
  const ctx = legacyDouble<BaseAudioContext>({ sampleRate: 48000, get currentTime() { return now; }, state: 'running',
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    createGain: gain, createBufferSource: () => {
      const target = new EventTarget();
      const stop = vi.fn<() => void>(); stops.push(stop);
      const source = legacyDouble<AudioBufferSourceNode>({ buffer: null, loop: false, loopStart: 0, loopEnd: 0,
        connect: () => gain(), disconnect: () => undefined, stop,
        start: (at = 0, offset = 0) => { starts.push([at, offset]); },
        addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) });
      sources.push(source); return source;
    } });
  const calm = legacyDouble<AudioBuffer>({ duration: 20 }), tension = legacyDouble<AudioBuffer>({ duration: 20 });
  const audio: SlotAudio = { genre: 'piano', slot: 'island', calm, tension: undefined, layers: [],
    spec: { calm: 'calm.m4a', tension: 'tension.m4a', bpm: 120, beatsPerBar: 4, loopStart: 2, loopEnd: 18, duration: 20, layers: [], phases: {} } };
  const deck = withOwner(owner, () => new Deck(ctx, audio, gain(), .1, 0));
  return { owner, deck, audio, calm, tension, sources, starts, stops, advance: (time: number) => { now = time; } };
}

test('late tension joins the original loop phase without restarting calm and releases both sources', async () => {
  const f = fixture();
  try {
    f.advance(31.1); f.deck.setTension(1, 31.1);
    await f.deck.completeTension(f.tension);
    expect(f.starts).toEqual([[.1, 0], [32.1, 16]]);
    expect(f.sources[0]?.buffer).toBe(f.calm); expect(f.sources[1]?.buffer).toBe(f.tension);
    expect(f.deck.level).toBe(1); expect(f.deck.audio).toBe(f.audio);
    await f.deck.completeTension(f.tension); expect(f.sources).toHaveLength(2);
    f.owner.dispose();
    for (const source of f.sources) expect(source.buffer).toBeNull();
    for (const stop of f.stops) expect(stop).toHaveBeenCalledOnce();
  } finally { f.owner.dispose(); }
});

test.each(['retire', 'fade'] as const)('a %s before late tension prevents new source publication', async action => {
  const f = fixture();
  try {
    if (action === 'retire') f.owner.dispose(); else f.deck.fadeOut(.1, 2);
    await f.deck.completeTension(f.tension);
    expect(f.sources).toHaveLength(1);
  } finally { f.owner.dispose(); }
});

test('a different recording length refuses late tension while the original calm remains live', async () => {
  const f = fixture();
  try {
    await expect(f.deck.completeTension(legacyDouble<AudioBuffer>({ duration: 22 }))).rejects.toThrow('length differs');
    expect(f.sources).toHaveLength(1); expect(f.sources[0]?.buffer).toBe(f.calm);
  } finally { f.owner.dispose(); }
});
