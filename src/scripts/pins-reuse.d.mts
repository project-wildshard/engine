export const MANIFEST: string;
export const KEY_SOURCES: readonly string[];
export const KEY_EXEMPT: Readonly<Record<string, string>>;
export interface PinDescriptor {
  readonly slug: string;
  readonly hash: string;
  readonly uploadNumber: number;
  readonly bytes: number;
}
export interface PinOwner {
  folder: string;
  descriptor: string;
  mounts: string[];
}
interface Incremental {
  inputs: string;
  owners: Record<string, PinOwner>;
}
export interface Manifest {
  version: number;
  key: string;
  products: Record<string, Record<string, string>>;
  mounts: Record<string, string>;
  incremental?: Incremental;
}
export interface Reused {
  source: string;
  mode: 'in place' | 'clone' | 'copy';
  files: number;
  bytes: number;
  published: string[];
  seconds: { clone: number; verify: number };
}
export function pinsCompatibilityKey(root: string, revision: string): string;
export function pinsKey(root: string, revision: string, inputs?: string): string;
export function pinDescriptor(pin: PinDescriptor): string;
export function dropManifest(root: string): void;
export function stalePinFolders(root: string, hashes?: readonly string[]): { folder: string; uploadNumber: unknown }[];
export function pruneStalePinProducts(root: string, hashes?: readonly string[]): { folder: string; uploadNumber: unknown }[];
export function verifiedPinsOutputs(root: string): { paths: Set<string>; key: string };
/** Meta QA 11-26 row 29: the ledger mounts whose bytes still hash to the manifest, whatever its key (a gate copy borrows them). */
export function manifestMounts(root: string, manifest?: Manifest): Set<string>;
export function writeManifest(root: string, key: string, products: Manifest['products'], mounts: Manifest['mounts'], incremental?: Incremental): void;
export function lockPins(root: string, options?: { wait?: boolean }): (() => void) | undefined;
export function hashFiles(files: readonly { path: string; bytes: number }[]): Promise<string[]>;
export function reusePins(root: string, key: string, options?: { sources?: readonly string[]; log?: (line: string) => void }): Promise<Reused | undefined>;
/** FORMAT-PRUNE FP59: the first product whose build receipt the app build would refuse under `revision`. */
export function staleReceipt(source: string, folders: readonly string[], revision: string): string | undefined;
export function reuseUnchangedPins(root: string, inputs: string, pins: readonly PinDescriptor[]): Promise<(Pick<Manifest, 'products' | 'mounts'> & {owners: Incremental['owners']}) | undefined>;
export function folderName(name: string): boolean;
export function mountPath(path: string): boolean;
export function insideTree(root: string, rel: string, make?: boolean): void;
