/** Existing 7×7 masked SSIM; raw image reads and a bounded binary PNG handoff. */
export function ssim(images: {a: string; b: string; diff?: string; mask?: number[][]}): Promise<{
  hasDiff: boolean; ssim: number | null; full?: number; masked?: number; note: string | null;
}>;
