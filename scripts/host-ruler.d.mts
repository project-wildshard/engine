import type { ClientPlanRoots } from './host-ruler/roots.mjs';
import type { NativeAssemblyRoots } from './host-ruler/server-roots.mjs';

export interface TableRule { readonly static: boolean; readonly dynamic: boolean }
export declare const TABLES: Readonly<Record<string, TableRule>>;
export interface ModuleFacts {
  readonly lines: number;
  readonly imports: readonly string[];
  readonly dynamic: readonly string[];
  readonly declarations: readonly { readonly names: readonly string[]; readonly lines: number }[];
}
export interface TreeReader {
  readonly root: string;
  readonly followed: (module: string) => boolean;
  readonly read: (module: string) => ModuleFacts;
}
export interface ModuleUse { lines: number; users: string[] }
export interface ProductRootModules {
  readonly slug: string;
  readonly roots: readonly string[];
  readonly unmeasured: readonly { readonly host: string; readonly reason: string }[];
}
export interface RulerReport {
  readonly products: readonly ProductRootModules[];
  readonly modules: ReadonlyMap<string, ModuleUse>;
  readonly oneUser: ReadonlyMap<string, { modules: number; lines: number }>;
}
export function codeLines(source: string, path?: string): number;
export function createTreeReader(options?: { readonly root?: string; readonly format?: boolean }): TreeReader;
export function reach(roots: Iterable<string>, reader: TreeReader, tables?: Readonly<Record<string, TableRule>>): Set<string>;
export function productRootModules(dir: string, tables?: { readonly plan?: ClientPlanRoots; readonly native?: NativeAssemblyRoots }): ProductRootModules;
export function measure(users: readonly { readonly slug: string; readonly roots: Iterable<string> }[], reader: TreeReader, tables?: Readonly<Record<string, TableRule>>): Map<string, ModuleUse>;
export function oneUserLines(modules: ReadonlyMap<string, ModuleUse>, slugs: readonly string[]): Map<string, { modules: number; lines: number }>;
export function rule(dirs: readonly string[], options?: { readonly root?: string }): RulerReport;
export function formatTable(report: RulerReport): string;
