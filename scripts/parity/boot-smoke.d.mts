import type { FloorGridPlan, FloorGridWitness } from '../frame-floor-grid.mjs';
import type { Browser } from 'playwright';

/** Require both actual warm owners before the native title capture clock starts. */
export function titleCaptureReady(observation:{appState:string;titlePreparation:unknown},catalogueOnly?:boolean):boolean;

/** Preserve a static-preview error transport's original payload for CI diagnosis, including nonfatal lifecycle diagnostics. */
export function bootErrorReport(url: string, method: string, body: string | null): unknown;
/** Only nonfatal boot-after-hide/nav-navigate diagnostics following observed grid navigation are acknowledged. */
export function bootLifecycleDiagnostic(report: unknown, observedGridNavigation: boolean): boolean;
/** Read the installed catalogue in the actual built title document. */
export function bootCatalogue(): { slug: string; status: string; legacy: boolean; shardSelect: boolean }[];
/** Public-policy admission observes a hydrated title, an unwaived public mode and a locked experimental card. */
export function publicPolicyAdmission(observation: { shard:string; appState:string; entered?:boolean; playerValid:boolean; fatal:string[]; frame:number; renderFrame:number }): { admitted:boolean; developer:boolean; locked:boolean; frame:number; renderFrame:number };
/** Complete selectable public, Developer and grid cases; frozen copies and explicit grid-only rows are excluded. */
export function bootCases(catalogue: readonly { slug: string; status: string; legacy: boolean; shardSelect?: boolean }[], group?: 'all' | 'public' | 'developer' | 'grid'): readonly (readonly ['standalone' | 'grid' | 'public-policy', string, boolean])[];

/** Plan the required real Signal road crossing from the running grid catalogue. */
export function bootSignalRoadPlan(state: unknown): FloorGridPlan;
/** Refuse missing Signal transitions, live residency or actual road frames. */
export function verifyBootSignalRoad(witness: FloorGridWitness): void;

/** Actual Template border entry and checkpoint-backed departure, sharing Signal's original 90-second budget. */
export function bootTemplateRoadPlans(state: unknown): {entry: FloorGridPlan; exit: FloorGridPlan};
/** Read durable storage only; a retryable save-service fallback cannot satisfy this proof. */
export function bootTemplateCheckpoint(instance: string, raw?: string | null): {instance:string; mode:'exact'|'logical'; revision:number; integrity:number; snapshotCharacters:number; storageCharacters:number};
/** A world's document where this page keeps it: IndexedDB for a server's saves, localStorage for a page's. */
export function bootStoredSave(instance: string): Promise<string | null>;
/** Both real frame commits and the matching durable Template namespace must be present. */
export function verifyBootTemplateRoad(result: {entry:FloorGridWitness;exit:FloorGridWitness;checkpoint:ReturnType<typeof bootTemplateCheckpoint>}):void;

/** Give the grid a fresh browser after prior contexts are closed, preserving every case law. */
export function bootCaseBrowser<T>(pool: {browser:(slot:number)=>Promise<T>;release:(slot:number)=>Promise<void>}, mode:'standalone'|'grid'|'public-policy'):Promise<T>;

/** Discover actual built-title rows through its normal document. */
export function discoverCatalogue(browser: Browser, base: string): Promise<{slug:string;status:string;legacy:boolean;shardSelect:boolean}[]>;

/** Failure-only small travel telemetry and observer ownership, without a full residency census. */
export function bootRoadCompletionState(): unknown;
/** Preserve the original error as cause and bound a failed-page diagnostic to 1000 ms. */
export function bootRoadFailure(read:()=>Promise<unknown>, primary:unknown):Promise<Error>;
