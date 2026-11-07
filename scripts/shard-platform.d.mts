import type {OutputReader} from './shard-platform-output.mjs';
import type { ComponentInventory } from './shard-components.mjs';
import type {ListedViewInventory} from './listed-view-code.mjs';

export interface PlatformModuleCharge {path:string;lines:number;excludedLines?:readonly number[]}

/** G291's primary measure; native shards have no frozen denominator. */
export interface ConversionMeasure {
  metric: 'runtime-vs-legacy' | 'native'; customRuntimeLines: number; shardRuntimeLines: number; rawGlslLines: number; additionalGlslLines: number;
  legacyLines: number | null; legacyFolder: string | null; legacyRevision: string | null;
  runtimeShare: number | null; passed: boolean | null;
  /**
   * G294/G312: transitive real primary users, deduplicated; templates and frozen copies never supply users. `modules` are
   * whole files one shard reaches without the game shell; `exports` are top-level declarations (`exported: false` for a
   * helper) that exactly one shard reaches inside a file multiple consumers reach. Entry/session/menu/loadout shell roots
   * are consumers through named reach for the documented control-plane modules and UI bridges only.
   * Loading species/models/rendering content never supplies a second content user.
   */
  gameSystemAttribution: { status: 'import-graph'; review: 'G294-primary-reach'; lines: number; modules: PlatformModuleCharge[];
    exports: { path: string; name: string; exported: boolean; lines: number }[]; pendingSecondUser?: PendingPlatformCharge[] };
}
export interface CustomSource {path:string;ownerPath?:string;kind:'runtime-ts'|'additional-glsl'|'sole-module'|'sole-export';lines:number;name?:string;excludedLines?:readonly number[]}
export interface ShardLines {
  /** G570 additive labels only; custom totals, percentages and gates remain unchanged. */
  listedView?:ListedViewInventory;
  measurement?:'built-output'|'source';
  customSectionBytes?:number;
  customSections?:{name:string;bytes:number}[];
  oneUserBuildTools?:{lines:number;files:{path:string;lines:number;bytes:number}[]};
  components?:ComponentInventory;
  customSources?:CustomSource[];
  runtimeLines: number; trustedRuntimeLines: number; assemblyScriptLines: number; conversion: ConversionMeasure;
  /** G454 visibility only: AS must trend to <=10% of frozen TS, without a gate yet. */
  assemblyScriptBudget:{ceiling:number|null;share:number|null;passed:boolean|null;enforcement:'report-only'};
}
export interface ShardPlatformList { baseline: Record<string, number>; enforced: Record<string, number> }
export interface MilestoneFlags { headless: boolean }
export function codeLines(source: string, path?: string): number;
/** AST-proven erased JSON module declarations; executable syntax stays custom. */
export function jsonTypeContract(source: string, path: string): boolean;
export function shardLines(root?: string, includeSources?: boolean): Record<string, ShardLines>;
/** Strict output-only P4 measure; never falls back to an authoring closure. */
export function outputShardLines(root?:string,includeSources?:boolean,products?:string,only?:string[]|null):Record<string,ShardLines>;
/** Full source-basis inventory for progress/components, never canonical output credit. */
export function sourceProgressInventory(root?:string,products?:string):Record<string,ShardLines>;
/** Shared syntax facts; all attribution and component rules retain their own basis. */
export function outputCensus(root?:string,products?:string,reader?:OutputReader):{measures:Record<string,ShardLines>;inventory:Record<string,ShardLines>;source:ReturnType<typeof sourceProgressLines>};
/** G458 labelled source estimate only; never supplies output % or badges. */
export function sourceProgressLines(root?:string,products?:string):Record<string,{basis:'source';customLines:number;legacyLines:number|null;assemblyScriptLines:number;assemblyScriptBudget:ShardLines['assemblyScriptBudget']}>;
export function milestoneFlags(slug: string, row: ShardLines, root?: string): MilestoneFlags;
export function checkShares(recorded: ShardPlatformList, lines: Record<string, ShardLines>): string[];

/** Nonblank raw shader code lines, excluding comments and retaining quoted preprocessor paths. */
export function shaderCodeLines(source: string): number;
/** Raw GLSL in files or shader literals; declared graph nodes contribute zero. */
export function rawShaderLines(source: string, path: string, program?: unknown): number;

/** G390 headline, unavailable until the admitted product is present. */
export interface PortHeadline {customPercent:number|null;world:'yes'|'partial'|'no'|'unavailable';percent:number|null}
export function declarationOnlyConfig(source:string,path?:string):boolean;
/** G423: only root manifest data declarations qualify; runtime logic stays custom. */
export function declarationOnlyManifest(source:string,path?:string):boolean;
export function portHeadline(customPercent:number|null,content:{status:string;tiles:{total:number}|null;privateBinaries:readonly string[]}):PortHeadline;
export function portAverage(rows:Record<string,{port:PortHeadline}>):number|null;

/** G419 planned user, or a day-one feature receipt. Neither fabricates an actual user. */
export interface PendingPlatformUser {
  module:string; export?:string; shard?:'driftwood-isle'|'pine-hollow'|'nalati-grasslands'|'nine-dragon-stack';
  plan?:{path:string;row:string}; documentation:string; 'rechecked-by'?:'end of W3';
  approvedFeature?:{name:string;decision:{path:'docs/plans/decisions.md';row:'G473'|'G474'|'G475'|'G478'|'G483'|'G484'}};
}
export interface PendingPlatformCharge {path:string;name?:string;lines:number;status:'pending second user';users:PendingPlatformUser[]}
export function pendingPlatformUsers(root:string):PendingPlatformUser[];
export function partitionPendingPlatformUsers(slug:string,modules:PlatformModuleCharge[],exports:{path:string;name:string;exported:boolean;lines:number}[],allowances:PendingPlatformUser[]):{
  modules:PlatformModuleCharge[];exports:{path:string;name:string;exported:boolean;lines:number}[];pending:PendingPlatformCharge[];
};
