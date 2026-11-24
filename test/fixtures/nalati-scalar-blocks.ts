import type { ScalarChannelRows } from '@wildshard/format/scalarChannel';
import { liveGeographyBlock, liveGeographyBlocks } from './liveGeography';
export function scalarBlockBytes(data: ScalarChannelRows['data']): Uint8Array {
  return typeof data === 'string' ? Uint8Array.from(atob(data), value => value.codePointAt(0) ?? 0) : liveGeographyBlock(data.file);
}
export const readNalatiScalarBlocks = liveGeographyBlocks;
