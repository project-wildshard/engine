export const MANIFEST: string;
export const KEY_SOURCES: readonly string[];
export const KEY_EXEMPT: Readonly<Record<string, string>>;
export interface Manifest {
  version: number;
  key: string;
  products: Record<string, Record<string, string>>;
  mounts: Record<string, string>;
}
export interface Reused {
  source: string;
  mode: 'in place' | 'clone' | 'copy';
  files: number;
  bytes: number;
  published: string[];
  seconds: { clone: number; verify: number };
}
export function pinsKey(root: string, revision: string): string;
export function dropManifest(root: string): void;
export function writeManifest(root: string, key: string, products: Manifest['products'], mounts: Manifest['mounts']): void;
export function lockPins(root: string, options?: { wait?: boolean }): (() => void) | undefined;
export function hashFiles(files: readonly { path: string; bytes: number }[]): Promise<string[]>;
export function reusePins(root: string, key: string, options?: { sources?: readonly string[]; log?: (line: string) => void }): Promise<Reused | undefined>;
export function folderName(name: string): boolean;
export function mountPath(path: string): boolean;
export function insideTree(root: string, rel: string, make?: boolean): void;
