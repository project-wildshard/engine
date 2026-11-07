/** Context-free PCM storage for native-adapter lifecycle fixtures; no device or WebAudio renderer. */
export function pcmBuffer(frames: number): AudioBuffer {
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  return { length: frames, sampleRate: 48000, numberOfChannels: 2, duration: frames / 48000,
    getChannelData: (channel: number): Float32Array<ArrayBuffer> => {
      const data = channels[channel]; if (!data) throw new Error('Invalid channel'); return data;
    } } as AudioBuffer;
}
