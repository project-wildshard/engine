/** X7: exact known desktop SKUs only. Laptop/TGP and ambiguous integrated/Apple variants benchmark.
 * FP32 = shader lanes × two FLOPs per FMA × published boost GHz / 1000.
 * Rows deliberately do not infer performance from a generation number or an unqualified vendor name. */
export interface GpuClass { match: RegExp; tflops: number; source: string; model: string }
const nvidia = 'https://www.nvidia.com/en-gb/geforce/graphics-cards/compare/';
const amd = 'https://www.amd.com/en/products/graphics/desktops/radeon/6000-series/';
export const DESKTOP_TFLOPS = 12.7;
export const GPU_CLASSES: readonly GpuClass[] = [
  { match: /\bGTX\s*1660\s*(?:SUPER|Ti)?\b/i, tflops: 5.4, source: nvidia, model: 'GTX 1660 family (upper bound)' },
  { match: /\bRTX\s*2060\b/i, tflops: 7.2, source: nvidia, model: 'RTX 2060 family (upper bound)' },
  { match: /\bRTX\s*3050\b/i, tflops: 9.1, source: nvidia, model: 'RTX 3050' },
  { match: /\bRTX\s*3060\s*Ti\b/i, tflops: 16.2, source: nvidia, model: 'RTX 3060 Ti' },
  { match: /\bRTX\s*3060\b/i, tflops: 12.7, source: nvidia, model: 'RTX 3060' },
  { match: /\bRTX\s*3070\b/i, tflops: 20.3, source: nvidia, model: 'RTX 3070' },
  { match: /\bRTX\s*3080\b/i, tflops: 29.8, source: nvidia, model: 'RTX 3080' },
  { match: /\bRTX\s*3090\b/i, tflops: 35.6, source: nvidia, model: 'RTX 3090' },
  { match: /\bRTX\s*4060\b/i, tflops: 15.1, source: nvidia, model: 'RTX 4060' },
  { match: /\bRTX\s*4070\b/i, tflops: 29.1, source: nvidia, model: 'RTX 4070' },
  { match: /\bRTX\s*4080\b/i, tflops: 48.7, source: nvidia, model: 'RTX 4080' },
  { match: /\bRTX\s*4090\b/i, tflops: 82.6, source: nvidia, model: 'RTX 4090' },
  { match: /\bRX\s*6600\b/i, tflops: 8.93, source: `${amd}amd-radeon-rx-6600.html`, model: 'RX 6600' },
  { match: /\bRX\s*6700\s*XT\b/i, tflops: 13.21, source: `${amd}amd-radeon-rx-6700-xt.html`, model: 'RX 6700 XT' },
  { match: /\bRX\s*6800\b/i, tflops: 16.17, source: `${amd}amd-radeon-rx-6800.html`, model: 'RX 6800' },
];
export function gpuClass(renderer: string): GpuClass | undefined {
  // Mobile parts' power envelopes vary; a desktop SKU's throughput must never classify them.
  if (/Laptop|Max-Q|\b(?:GTX|RTX)\s*\d+M\b|\bRX\s*\d+M\b/i.test(renderer)) return undefined;
  return GPU_CLASSES.find((row) => row.match.test(renderer));
}
