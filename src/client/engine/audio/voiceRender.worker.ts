// meta IPHONE13-DRIFTWOOD DW3 (mini-driftwood13d): the prewarm's voice renders, off the main thread. On the iPhone 13 a
// first footstep on Driftwood's pier armed the declared bank's prewarm, and its renders (vocal-sailor 66-96 ms a slice,
// windup-sailor 105-171 ms) held the main thread for about 1.1 s of the next 2 s: 60-164 ms gaps with no WebGL work while
// the GPU's longest pass was 9 ms (Metal System Trace). Each request is one channel of one variant; the reply transfers it.
import { installWorkerBootTiming } from '../../../shared/engine/boot/workerTiming';
import { renderVoiceWork, type VoiceWork } from './voiceFamilies';

installWorkerBootTiming('voice-render');

self.onmessage = (event: MessageEvent<{ id: number; work: VoiceWork; sr: number; seed: number; ch: number }>): void => {
  const { id, work, sr, seed, ch } = event.data;
  try {
    const data = renderVoiceWork(work, sr, seed, ch);
    self.postMessage({ id, data }, { transfer: [data.buffer] });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, { transfer: [] });
  }
};
// DF8 (mini-driftwood13f): the pool starts a job's render deadline only from here, so a slow cold script load is not a failed render
self.postMessage({ ready: true }, { transfer: [] });
