/** OFF-VERCEL OV3: Workers static assets take 100,000 files a version (we stop at 90,000) and 25 MiB a file. */
export const MAX_ASSET_FILES: number;
export const MAX_ASSET_BYTES: number;
export interface AssetMeasure {
  readonly files: number;
  readonly maps: number;
  readonly largest: {readonly path: string; readonly bytes: number};
  readonly oversize: readonly {readonly path: string; readonly bytes: number}[];
}
/** Count the files a Workers upload of the directory carries (source maps left out) and find the largest. */
export function measureAssets(directory: string): AssetMeasure;
/** Throw above the file count or any file over the size limit. */
export function assertAssetLimits(directory: string): AssetMeasure;
/** One line: count, largest file, maps left out. */
export function describeAssetLimits(measured: AssetMeasure): string;
