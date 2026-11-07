import { memoryAttribution, type MemoryLabel } from './memoryAttribution';

/** Audio's decoded PCM capacity: float32 samples × frames × channels, once per shared AudioBuffer. */
export function observeAudioMemory<T extends Pick<AudioBuffer, 'length' | 'numberOfChannels'>>(buffer: T, label: MemoryLabel): T {
  memoryAttribution.label(buffer, label);
  memoryAttribution.observe(buffer, 'ram', 'audio-buffer', value => {
    const length: unknown = Reflect.get(value, 'length'), channels: unknown = Reflect.get(value, 'numberOfChannels');
    if (typeof length !== 'number' || typeof channels !== 'number') throw new TypeError('Invalid decoded audio identity');
    return length * channels * 4;
  });
  return buffer;
}
/** Linear-memory capacity follows growth; the diagnostic never calls a Wasm export or copies its bytes. */
export function observeWasmMemory(memory: WebAssembly.Memory, label: MemoryLabel): void {
  memoryAttribution.label(memory, label);
  memoryAttribution.observe(memory, 'ram', 'wasm', value => {
    if (!(value instanceof WebAssembly.Memory)) throw new TypeError('Invalid linear memory identity');
    return value.buffer.byteLength;
  });
}
