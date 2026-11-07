export interface GridAssetAddress { readonly url: string; readonly bytes: number; readonly sha256: string }
export interface GridSeamAsset { readonly fileName: string; readonly source: string; readonly files?: readonly GridAssetAddress[];
  readonly plans?: { readonly fileName: string; readonly source: string; readonly address: GridAssetAddress };
  readonly address: GridAssetAddress & { readonly plans?: GridAssetAddress;
    readonly edgeCosts?: { readonly source: string; readonly rows: readonly (readonly [string, number])[] };
    readonly geometry?: { readonly directory: GridAssetAddress; readonly homes: readonly string[] } } }
/** The baked seams' path under the repo root (gitignored). */
export const GRID_SEAMS: string;
/** Preserve the original wire by default; optionally split canonical native fallback plans into a verified file. */
export function gridSeamAsset(source: string, splitPlans?: boolean): GridSeamAsset;
/** Bake and certify the grid seams into GRID_SEAMS. */
export function bakeGridSeams(root: string): void;
/** The baked seams' asset (throws when the app build has not baked them). */
export function readGridSeams(root: string): GridSeamAsset;
/** Write the baked seams' exact bytes as their hashed asset into `outDir`. */
export function writeGridSeams(outDir: string, root: string): void;
