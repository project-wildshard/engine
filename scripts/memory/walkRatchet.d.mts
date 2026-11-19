import type { LedgerRow } from './ledgerVerdict.mjs';
import type { BudgetBaselines, BudgetCaps } from '../budgets/files.mjs';

export const WALK_RATCHET: URL;
export interface Held {value:number;spread:number;judged:boolean;why?:string}
export interface WalkBaseline {version:3;mode:'walk';boot:'online';zone:string;seconds:number;runs:number;source:string;peak:Held}
export interface Read {median:number;min:number;max:number;n:number}
export interface WalkSummary {complete:boolean;bytesPerSecond:Read;peakAboveSettled:Read}
export interface WalkJudging {contentKey:string;budgets:{caps:BudgetCaps;baselines:BudgetBaselines}}
export function parseWalkBaseline(value:unknown):WalkBaseline;
export function walkBaseline():WalkBaseline;
export function walkRateKey(baseline:WalkBaseline):string;
export function walkRateRow(baseline:WalkBaseline,summary:WalkSummary,judging:WalkJudging):LedgerRow;
export function compareWalk(baseline:WalkBaseline,summary:WalkSummary,judging:WalkJudging):string|null;
export function walkVerdict(baseline:WalkBaseline,first:WalkSummary,again:WalkSummary|null,judging:WalkJudging):{state:'pass'|'spike'|'fail';failure:string|null};
export function walkMeasures(baseline:WalkBaseline,summary:WalkSummary,contentKey:string):Record<string,{value:number;contentKey:string}>;
export function bimodal(values:readonly number[]):boolean;
export function reportedLines(baseline:WalkBaseline,summary:WalkSummary,peaks:readonly number[]):string[];
