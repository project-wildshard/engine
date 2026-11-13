import type { ClientPlanRoots } from './host-ruler/roots.mjs';
import type { NativeAssemblyRoots } from './host-ruler/server-roots.mjs';

export interface TableRule { readonly static: boolean; readonly dynamic: boolean }
export declare const TABLES: Readonly<Record<string, TableRule>>;
export declare const SHELL: '@shell';
export declare const SHELL_ROOTS: readonly string[];
export declare const SHELL_CONTROL: readonly string[];
export declare const FORMAT: '@wildshard/format';
export interface ModuleFacts {
  readonly lines: number;
  readonly imports: readonly string[];
  readonly dynamic: readonly string[];
  readonly opaque: readonly string[];
  readonly declarations: readonly { readonly names: readonly string[]; readonly lines: number }[];
}
export interface FormatPackage {
  readonly dir: string;
  readonly version: string;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly published: (path: string) => boolean;
}
export interface TreeReader {
  readonly root: string;
  readonly format: FormatPackage;
  readonly followed: (module: string) => boolean;
  readonly read: (module: string) => ModuleFacts;
}
export interface ModuleUse { lines: number; layer: string; users: string[] }
export interface OneUserTotal { modules: number; lines: number; format: number }
export interface ProductRootModules {
  readonly slug: string;
  readonly roots: readonly string[];
  readonly unmeasured: readonly { readonly host: string; readonly reason: string }[];
}
export interface RulerReport {
  readonly products: readonly ProductRootModules[];
  readonly format: string;
  readonly modules: ReadonlyMap<string, ModuleUse>;
  readonly oneUser: ReadonlyMap<string, OneUserTotal>;
}
export interface MeasureOptions {
  readonly tables?: Readonly<Record<string, TableRule>>;
  readonly shell?: { readonly roots: Iterable<string>; readonly control: readonly string[] };
}
export function codeLines(source: string, path?: string): number;
export function formatPackage(dir: string): FormatPackage;
export function createTreeReader(options?: { readonly root?: string; readonly format?: boolean; readonly formatDir?: string }): TreeReader;
export function layerOf(module: string): string;
export function reach(roots: Iterable<string>, reader: TreeReader, tables?: Readonly<Record<string, TableRule>>): Set<string>;
export function productRootModules(dir: string, tables?: { readonly plan?: ClientPlanRoots; readonly native?: NativeAssemblyRoots }): ProductRootModules;
export function measure(users: readonly { readonly slug: string; readonly roots: Iterable<string> }[], reader: TreeReader, options?: MeasureOptions): Map<string, ModuleUse>;
export function oneUserLines(modules: ReadonlyMap<string, ModuleUse>, slugs: readonly string[]): Map<string, OneUserTotal>;
export function rule(dirs: readonly string[], options?: { readonly root?: string }): RulerReport;
export function formatTable(report: RulerReport): string;
