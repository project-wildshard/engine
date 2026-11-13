import type { ModuleRoot, ProductRoot } from './roots.mjs';

export declare const NATIVE_HOSTS: string;
export declare const NATIVE_ASSEMBLY: string;
export declare const NATIVE_ASSEMBLY_ROOT: '@native-assembly';
export declare const NATIVE_ASSEMBLY_FILE: 'server/native-assembly.json';
export declare const NATIVE_GATED: Readonly<Record<string, readonly string[]>>;
export interface NativeAssemblyRoots {
  readonly shared: readonly ModuleRoot[];
  readonly hosts: ReadonlyMap<string, { readonly roots: readonly ModuleRoot[]; readonly unplaced: readonly string[] }>;
  readonly unattributed: readonly string[];
  readonly imports: number;
}
export interface ServerRoots {
  readonly slug: string;
  readonly hosts: readonly string[];
  readonly roots: readonly ProductRoot[];
  readonly unmeasured: readonly { readonly host: string; readonly reason: string }[];
  readonly modules: readonly ModuleRoot[];
}
export function nativeAssemblyRoots(input?: { readonly root?: string; readonly hosts?: { readonly path: string; readonly source: string }; readonly assembly?: { readonly path: string; readonly source: string } }): NativeAssemblyRoots;
export function serverRootsFrom(product: { readonly slug: string; readonly hosts: readonly string[] | null }, table?: NativeAssemblyRoots): ServerRoots;
export function productServerRoots(dir: string, table?: NativeAssemblyRoots): ServerRoots;
