import type {BudgetBaselines,BudgetCaps} from '../budgets/files.mjs';

export interface FrameSummary {fps:number;p95:number;gpu95:number;draws95:number;tris95:number}
export interface NineReading {
 renderer:string;seconds:number;throttle:number;dpr:number;phone:boolean;
 load:{phases:{control:number};stage:{op:string;ms:number}[]};
 play:{pixelRatio:number;all:FrameSummary;minutes:FrameSummary[];
 route:{name:string;reached:number;stuck:unknown[];path:number[][]}};
}
export interface NineJudging {contentKey:string;budgets:{caps:BudgetCaps;baselines:BudgetBaselines}}
export const NINE_LIMITS: Readonly<{fps:number;frame95:number;gpu95:number;controlMs:number;shadersMs:number;firstFrameMs:number}>;
export const NINE_STREET_KEYS: Readonly<{triangles95:string;draws95:string}>;
export function nineJudging():NineJudging;
export function nineFaults(reading:NineReading,judging?:NineJudging):string[];
