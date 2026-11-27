/** SF20 (J525): a file's cost once the cook has made its KTX2 (`cooked-image-cost.mjs`). */
export interface CookedCost { decoded: number; gpu: number; compressed: number }
/** The cook's KTX2 of one image, as its byte length; undefined keeps the image's own bytes. */
export type Ktx2Bytes = (image: Uint8Array, as: { standalone: boolean }) => number | undefined;
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined;
export function cookedKtx2Cost(size: { width: number; height: number } | undefined): CookedCost | undefined;
export function cookedFileCost(row: { kind?: string; decoded: number; gpu: number; compressed: number }, bytes: Uint8Array, ktx2Bytes?: Ktx2Bytes): CookedCost | undefined;
