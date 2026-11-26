/** Immutable URLs derived from original title image bytes. */
export function titleAssetURLs(root: string): Record<string, string>;
/** Plain committed URL table and the matching static shell references. */
export function titleAssetTables(root: string): Record<string, string>;
/** Publish exact original image bytes at the declared immutable URLs. */
export function writeTitleAssets(root: string, outDir: string): void;
