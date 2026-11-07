import { nativeCompatibility } from '../compatibility/native';

/** Run the real Pine witness in plain Node, outside Vitest's DOM-like setup. */
export function pineWitness(mode: string, timeoutMs = 110_000): { status: number | null; stdout: string; stderr: string } {
  return nativeCompatibility('pine-hollow', mode, timeoutMs);
}
