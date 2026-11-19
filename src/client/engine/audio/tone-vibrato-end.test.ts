import { expect, test } from 'vitest';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { Synth } from './synth';

/** QA 11-19-mini row 27: WebKit renders a vibrato LFO only while its tone renders, so it must stop before the tone does. */
test('a vibrato LFO stops before the tone it modulates', () => {
  const stops: { kind: string; at: number }[] = [];
  const param = (): AudioParam => legacyDouble<AudioParam>({ value: 0, setValueAtTime: () => param(), exponentialRampToValueAtTime: () => param(),
    linearRampToValueAtTime: () => param(), setTargetAtTime: () => param(), cancelScheduledValues: () => param() });
  function connect(destination: AudioNode, output?: number, input?: number): AudioNode;
  function connect(destination: AudioParam, output?: number): void;
  function connect(destination: AudioNode | AudioParam): AudioNode | void { if ('connect' in destination) return destination; }
  const ports = { connect, disconnect: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined };
  let made = 0;
  const ctx = legacyDouble<AudioContext>({ currentTime: 2,
    createOscillator: () => {
      const kind = made++ === 0 ? 'tone' : 'lfo';
      return legacyDouble<OscillatorNode>({ ...ports, type: 'sine', frequency: param(), detune: param(), start: () => undefined,
        stop: (at?: number) => { stops.push({ kind, at: at ?? -1 }); } });
    },
    createGain: () => legacyDouble<GainNode>({ ...ports, gain: param() }),
    createBiquadFilter: () => legacyDouble<BiquadFilterNode>({ ...ports, type: 'lowpass', frequency: param(), Q: param() }),
    createStereoPanner: () => legacyDouble<StereoPannerNode>({ ...ports, pan: param() }),
  });
  class Probe extends Synth {
    readonly ctx = ctx; readonly sfx = legacyDouble<GainNode>({ ...ports, gain: param() }); readonly ready = true;
    protected readonly noise = legacyDouble<AudioBuffer>({});
  }
  new Probe().tone({ f0: 440, gain: 0.2, attack: 0.01, decay: 0.3, vibrato: { rate: 6, depth: 4 } });
  const tone = stops.find(row => row.kind === 'tone'), lfo = stops.find(row => row.kind === 'lfo');
  expect(tone?.at).toBeCloseTo(2 + 0.01 + 0.3 + 0.05);
  expect(lfo?.at).toBeLessThan(tone?.at ?? 0);
  expect(lfo?.at).toBeGreaterThan(2);
});
