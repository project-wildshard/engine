import type { ScalarChannelRows } from '@wildshard/format/scalarChannel';
import { frozenGeographyBlock, frozenGeographyBlocks } from './frozen/geography';
export function scalarBlockBytes(data: ScalarChannelRows['data']): Uint8Array {
  return typeof data === 'string' ? Uint8Array.from(atob(data), value => value.codePointAt(0) ?? 0) : frozenGeographyBlock(data.file);
}
export const readNalatiScalarBlocks = frozenGeographyBlocks;
