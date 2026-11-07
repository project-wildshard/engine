/** WebGL storage bytes, matching the independent GL census. These are allocation sizes, not driver residency. */
const SIZED: Readonly<Record<number, number>> = { 0x8229: 1, 0x822b: 2, 0x8051: 4, 0x8058: 4, 0x8c43: 4, 0x8c41: 4, 0x822d: 2, 0x822f: 4, 0x881b: 8, 0x881a: 8, 0x822e: 4, 0x8230: 8, 0x8815: 16, 0x8814: 16, 0x8c3a: 4, 0x8c3d: 4, 0x8059: 4, 0x8d62: 2, 0x8056: 2, 0x8057: 2, 0x8232: 1, 0x8231: 1, 0x8234: 2, 0x8233: 2, 0x8236: 4, 0x8235: 4, 0x823a: 4, 0x823c: 8, 0x8d7c: 4, 0x8d76: 8, 0x8d70: 16, 0x8d82: 16, 0x8f94: 1, 0x8f95: 2, 0x8f97: 4, 0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8d48: 1 };
const COMPONENTS: Readonly<Record<number, number>> = { 0x1908: 4, 0x1907: 4, 0x190a: 2, 0x1909: 1, 0x1906: 1, 0x1902: 1, 0x84f9: 1, 0x1903: 1 };
const TYPES: Readonly<Record<number, number>> = { 0x1401: 1, 0x1400: 1, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x1406: 4, 0x140b: 2, 0x8d61: 2 };
const PACKED: Readonly<Record<number, number>> = { 0x8363: 2, 0x8033: 2, 0x8034: 2, 0x84fa: 4, 0x8368: 4, 0x8c3b: 4, 0x8c3e: 4, 0x8dad: 8 };
const SMALL_BLOCKS = new Set([0x83f0, 0x83f1, 0x8c4c, 0x8c4d, 0x8dbb, 0x8dbc, 0x9270, 0x9271, 0x9274, 0x9275, 0x9276, 0x9277, 0x8d64]);
const LARGE_BLOCKS = new Set([0x83f2, 0x83f3, 0x8c4e, 0x8c4f, 0x8dbd, 0x8dbe, 0x8e8c, 0x8e8d, 0x8e8e, 0x8e8f, 0x9272, 0x9273, 0x9278, 0x9279]);
const ASTC = [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]] as const;
export function allocationImageBytes(format: number, width: number, height: number, depth = 1, external: number = format, type = 0x1401): number {
  const astc = ASTC[format >= 0x93d0 ? format - 0x93d0 : format - 0x93b0];
  if (astc !== undefined) return Math.ceil(width / astc[0]) * Math.ceil(height / astc[1]) * 16 * depth;
  if (SMALL_BLOCKS.has(format) || LARGE_BLOCKS.has(format)) return Math.ceil(width / 4) * Math.ceil(height / 4) * (SMALL_BLOCKS.has(format) ? 8 : 16) * depth;
  if (format === 0x8c00 || format === 0x8c02) return Math.max(width, 8) * Math.max(height, 8) / 2 * depth;
  if (format === 0x8c01 || format === 0x8c03) return Math.max(width, 16) * Math.max(height, 8) / 4 * depth;
  return width * height * depth * (SIZED[format] ?? PACKED[type] ?? (COMPONENTS[format] ?? COMPONENTS[external] ?? 4) * (TYPES[type] ?? 1));
}
