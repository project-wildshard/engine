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
  readonly rootKeys: readonly string[];
  readonly held: ReadonlySet<string>;
  readonly options: readonly string[];
  readonly unmeasuredOptions: readonly string[];
  readonly unmeasured: readonly { readonly host: string; readonly reason: string }[];
}
export interface RulerReport {
  readonly today: string;
  readonly ruled: Ruled;
  readonly options: readonly OptionCharge[];
  readonly totals: ReadonlyMap<string, ShardTotal>;
  readonly products: readonly ProductRootModules[];
  readonly format: string;
  readonly modules: ReadonlyMap<string, ModuleUse>;
  readonly oneUser: ReadonlyMap<string, OneUserTotal>;
  readonly root: string;
  readonly reader: TreeReader;
  readonly tables: { readonly plan: ClientPlanRoots; readonly native: NativeAssemblyRoots };
  readonly register: readonly RegisterRule[];
}
export interface MeasureOptions {
  readonly tables?: Readonly<Record<string, TableRule>>;
  readonly shell?: { readonly roots: Iterable<string>; readonly control: readonly string[] };
}
export function codeLines(source: string, path?: string): number;
export function formatPackage(dir: string): FormatPackage;
export function createTreeReader(options?: { readonly root?: string; readonly format?: boolean; readonly formatDir?: string }): TreeReader;
export function layerOf(module: string): string;
export function reach(roots: Iterable<string>, reader: TreeReader, tables?: Readonly<Record<string, TableRule>>, held?: ReadonlySet<string>): Set<string>;
export function productRootModules(dir: string, tables?: { readonly plan?: ClientPlanRoots; readonly native?: NativeAssemblyRoots }, options?: readonly OptionRow[]): ProductRootModules;
export function measure(users: readonly { readonly slug: string; readonly roots: Iterable<string>; readonly held?: ReadonlySet<string> }[], reader: TreeReader, options?: MeasureOptions): Map<string, ModuleUse>;
export function oneUserLines(modules: ReadonlyMap<string, ModuleUse>, slugs: readonly string[]): Map<string, OneUserTotal>;
export function rule(dirs: readonly string[], options?: { readonly root?: string; readonly today?: string; readonly register?: readonly RegisterRule[] }): RulerReport;
export function formatTable(report: Pick<RulerReport, 'format' | 'options' | 'products' | 'ruled' | 'today' | 'totals'>): string;
export declare const STATUSES: readonly ['platform', 'pending', 'no-row', 'charged-back', 'silly'];
export type Status = (typeof STATUSES)[number];
export interface RegisterRule { readonly key: string; readonly verdict: string; readonly decision?: string; readonly users: readonly string[]; readonly recheck?: string }
export interface RuledModule { readonly module: string; readonly user: string; readonly lines: number; readonly layer: string; readonly spans: Readonly<Record<Status, number>>; readonly rows: readonly string[] }
export interface Ruled {
  readonly modules: ReadonlyMap<string, RuledModule>;
  readonly sillyShared: readonly { readonly module: string; readonly users: readonly string[]; readonly lines: number; readonly key: string }[];
}
export type ShardTotal = OneUserTotal & Record<Status | 'option' | 'charged', number>;
export function applyRegister(modules: ReadonlyMap<string, ModuleUse>, reader: TreeReader, rows: readonly RegisterRule[], options: { readonly today: string }): Ruled;
export function shardTotals(ruled: Ruled, slugs: readonly string[], options?: readonly { readonly user: string; readonly lines: number }[]): Map<string, ShardTotal>;
export interface OptionRow {
  readonly kind: string;
  readonly option: string;
  readonly when?: (value: unknown) => boolean;
  readonly from?: string;
  readonly bindings: readonly string[];
}
export declare const OPTIONS: readonly OptionRow[];
export interface OptionCharge { readonly key: string; readonly user: string; readonly option: string; readonly lines: number }
export function optionCharges(modules: ReadonlyMap<string, ModuleUse>, products: readonly { readonly slug: string; readonly options?: readonly string[]; readonly rootKeys?: readonly string[] }[], reader: TreeReader, options?: readonly OptionRow[]): OptionCharge[];
export interface InventoryRow { readonly module: string; readonly layer: string; readonly lines: number; readonly users: readonly string[]; readonly register: string; readonly entry: string }
export function inventory(report: RulerReport, options?: { readonly sharddev?: string }): InventoryRow[];
export function formatInventory(rows: readonly InventoryRow[]): string;
