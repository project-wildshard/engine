export declare const ENGINE_ROOT: string;
export declare const CLIENT_PLAN: string;
export declare const CLIENT_PLAN_ROOT: '@client-plan';
/** Section name -> host selectors (`src/...ts#binding`, `@wildshard/format/x#binding` or `@client-plan`). */
export declare const SECTION_HOSTS: Readonly<Record<string, readonly string[]>>;
export interface ModuleRoot { readonly module: string; readonly bindings: readonly string[] }
export interface FolderRoot extends ModuleRoot { readonly from: string }
export type ImportShape = 'member' | 'destructure' | 'all';
export interface ClientPlanRoots {
  readonly shared: readonly (ModuleRoot & { readonly specifier: string; readonly typeOnly: boolean })[];
  readonly kinds: ReadonlyMap<string, readonly ModuleRoot[]>;
  readonly kindShapes: ReadonlyMap<string, readonly ImportShape[]>;
  readonly shapes: Readonly<Record<ImportShape, number>>;
  readonly dynamicImports: number;
}
export interface FolderRoots {
  readonly slug: string;
  readonly sections: readonly string[];
  readonly kinds: readonly string[];
  readonly roots: readonly FolderRoot[];
  readonly modules: readonly ModuleRoot[];
}
export function resolveModule(specifier: string, from: string, root?: string): string;
export function clientPlanRoots(root?: string): ClientPlanRoots;
export function modulePath(module: string, root?: string): string | null;
export function unresolvedRoots(rows: readonly ModuleRoot[], root?: string): string[];
export function sectionHostRows(): ModuleRoot[];
export function folderRootsFrom(product: { readonly slug: string; readonly sections: readonly string[]; readonly kinds: readonly string[] }, plan?: ClientPlanRoots): FolderRoots;
export function folderRoots(dir: string, plan?: ClientPlanRoots): FolderRoots;
