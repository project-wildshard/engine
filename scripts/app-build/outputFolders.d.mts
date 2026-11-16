/** The app publishes its data products, never their temporary TypeScript sources. */
export function copyOutputFolders(root: string, outDir: string): void;

/** Refuse a public/ copy of a product mount whose bytes differ from the product's; returns the mounts checked. */
export function checkPublishedMounts(root: string): number;

/** DL20: drop the loose files only a part needs to hold; a default manifest's files stay. */
export function pruneLooseCopies(outDir: string): { files: number; bytes: number };

/** Only the standard, fresh, managed app output defers the public copy. */
export function deferredPublicCopy(root: string, outDir: string, args: string[]): boolean;
/** Publish public files except the obsolete top-level shardfiles tree. */
export function copyDeferredPublic(root: string, outDir: string): void;
