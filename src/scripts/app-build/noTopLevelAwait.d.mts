/** Throws when emitted JavaScript can suspend its module's evaluation, or cannot be parsed. */
export function assertNoTopLevelAwait(fileName: string, code: string): void;
/** Checks every JavaScript file the build wrote to `outDir`, skipping copies of `publicDir` files. */
export function checkNoTopLevelAwait(outDir: string, publicDir: string): void;
