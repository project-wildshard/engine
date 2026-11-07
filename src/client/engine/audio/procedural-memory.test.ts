import { expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { memoryAttribution } from '../../../shared/engine/core/memoryAttribution';
import { Music } from './Music';
import { Audio } from './Audio';
import { releasePageAudioContext } from './unlock';

function connect(destination: AudioNode, output?: number, input?: number): AudioNode;
function connect(destination: AudioParam, output?: number): void;
function connect(destination: AudioNode | AudioParam): AudioNode | void {
  if ('connect' in destination) return destination;
}
function graph() {
  const buffers: AudioBuffer[] = [], sources: AudioBufferSourceNode[] = [];
  const events = new EventTarget();
  const ports = { connect, disconnect: () => undefined,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  const param = (): AudioParam => {
    const value: AudioParam = legacyDouble<AudioParam>({ value: 0,
      setValueAtTime: next => { value.value = next; return value; },
      linearRampToValueAtTime: next => { value.value = next; return value; } });
    return value;
  };
  const gain = (): GainNode => legacyDouble<GainNode>({ ...ports, gain: param() });
  const context = legacyDouble<AudioContext>({
    currentTime: 0, sampleRate: 48000, destination: legacyDouble<AudioDestinationNode>(ports),
    createGain: gain,
    createBiquadFilter: () => legacyDouble<BiquadFilterNode>({ ...ports, frequency: param(), Q: param() }),
    createDelay: () => legacyDouble<DelayNode>({ ...ports, delayTime: param() }),
    createOscillator: () => legacyDouble<OscillatorNode>({ ...ports, frequency: param(), start: () => undefined, stop: () => undefined }),
    createStereoPanner: () => legacyDouble<StereoPannerNode>({ ...ports, pan: param() }),
    createDynamicsCompressor: () => legacyDouble<DynamicsCompressorNode>({ ...ports,
      threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createBuffer: (numberOfChannels, length, sampleRate) => {
      const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      const buffer = legacyDouble<AudioBuffer>({ numberOfChannels, length, sampleRate, duration: length / sampleRate,
        getChannelData: channel => { const data = channels[channel]; if (data === undefined) throw new Error('Missing PCM channel'); return data; } });
      buffers.push(buffer); return buffer;
    },
    createBufferSource: () => {
      const source = legacyDouble<AudioBufferSourceNode>({ ...ports, buffer: null, start: () => undefined, stop: () => undefined });
      sources.push(source); return source;
    },
  });
  return { context, gain, buffers, sources };
}
const rows = (owner: string) => memoryAttribution.snapshot().allocations.filter(row => row.owner === owner && row.kind === 'audio-buffer');
test('Music labels its noise and shared pitch PCM under its construction owner', () => {
  const owner = new Scope('music-pcm-owner'), consumer = new Scope('music-pcm-consumer'), g = graph();
  const music = withOwner(owner, () => new Music(legacyDouble<Audio>({ ctx: g.context, master: g.gain() })));
  try {
    const engine = withOwner(consumer, () => music.engine);
    engine.pluck(62, 0, 1, 1); engine.pluck(74, 0, 1, 1); engine.pluck(62, 1, 1, 1);
    const first = g.sources[0]?.buffer, repeated = g.sources[2]?.buffer;
    expect(first).toBe(repeated);
    expect(g.buffers.map(buffer => buffer.length)).toEqual([96000, 96000, 67200]);
    expect(rows(owner.name).map(row => row.bytes).sort((a, b) => a - b)).toEqual([268800, 384000, 384000]);
    expect(rows(consumer.name)).toHaveLength(0);
  } finally { consumer.dispose(); owner.dispose(); }
});

test('Audio labels one mixer noise buffer without rebuilding its graph', () => {
  const owner = new Scope('mixer-pcm-owner'), consumer = new Scope('mixer-pcm-consumer'), g = graph();
  const audio = withOwner(owner, () => new Audio());
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: function AudioContext(): AudioContext { return g.context; } } });
  try {
    const first = withOwner(consumer, () => audio.master);
    expect(audio.master).toBe(first); expect(g.buffers).toHaveLength(1);
    expect(rows(owner.name).map(row => row.bytes)).toEqual([384000]);
    expect(rows(consumer.name)).toHaveLength(0);
  } finally {
    releasePageAudioContext(g.context); consumer.dispose(); owner.dispose();
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', previous);
  }
});
