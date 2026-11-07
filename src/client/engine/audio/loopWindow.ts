/** PCM operations lent by an AudioBuffer, also usable with offline sample fixtures. */
export interface LoopPcm {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData: (channel: number) => Float32Array<ArrayBuffer>;
  copyToChannel: (source: Float32Array<ArrayBuffer>, channel: number) => void;
}

/** Keep a loop's samples and neighbouring interpolation samples, without its unused recording intro/outro.
 * Only integer-sample cuts are eligible. Playback keeps its existing random offset, rate, gain and loop duration;
 * the caller lends allocation so no audio device is opened. The returned buffer exclusively owns its copied PCM.
 */
export function compactLoopWindow<T extends LoopPcm>(buffer: T, bounds: { readonly loopStart: number; readonly loopEnd: number },
  create: (length: number, channels: number, sampleRate: number) => T): { buffer: T; loopStart: number; loopEnd: number } {
  const original = { buffer, ...bounds }, start = bounds.loopStart * buffer.sampleRate, end = bounds.loopEnd * buffer.sampleRate;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > buffer.length) return original;
  // Retain neighbouring original samples for native interpolation at initial seek / the loop seam.
  const from = Math.max(0, start - 128), to = Math.min(buffer.length, end + 128);
  if (from === 0 && to === buffer.length) return original;
  const compact = create(to - from, buffer.numberOfChannels, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) compact.copyToChannel(buffer.getChannelData(channel).subarray(from, to), channel);
  return { buffer: compact, loopStart: (start - from) / buffer.sampleRate, loopEnd: (end - from) / buffer.sampleRate };
}
