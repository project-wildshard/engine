import type { Scope } from '../../../shared/engine/app/scope';
import type { SampleLoop } from './Audio';

export interface LoopBounds { loopStart: number; loopEnd: number; gain: number }

export interface LoopVoice { stop: (at?: number) => void }
export interface LoopStart {
  context: BaseAudioContext;
  output: AudioNode;
  owner: Scope;
  time: number;
  offset: number;
  ended: () => void;
}
export interface StreamLoop { start: (start: LoopStart) => LoopVoice }

export function sampleIdentity(sample: SampleLoop | undefined): AudioBuffer | StreamLoop | undefined {
  return sample === undefined ? undefined : 'buffer' in sample ? sample.buffer : sample.stream;
}

/** Both kinds feed the caller's existing gain, filters and pan. */
export function playSampleLoop(sample: SampleLoop, start: LoopStart): LoopVoice {
  if ('stream' in sample) return sample.stream.start(start);
  const { context, output, owner, time, offset, ended } = start;
  const node = context.createBufferSource();
  node.buffer = sample.buffer;
  node.loop = true; node.loopStart = sample.loopStart; node.loopEnd = sample.loopEnd;
  let live = true, started = false;
  const cleanup = (): void => {
    if (!live) return;
    live = false; node.disconnect(); node.buffer = null; ended();
  };
  const scoped = owner.capture('sounds', () => { if (started) node.stop(); cleanup(); });
  const off = owner.listen(node, 'ended', () => { scoped(); cleanup(); }, { once: true });
  try { node.connect(output); node.start(Math.max(time, context.currentTime), offset); }
  catch (error) { off(); scoped(); cleanup(); throw error; }
  started = true;
  return { stop: at => { if (live) node.stop(at); } };
}

export function loopOffset(sample: LoopBounds, random: () => number): number {
  return sample.loopStart + random() * (sample.loopEnd - sample.loopStart);
}
