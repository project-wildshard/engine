import type {Object3D} from 'three';
import type {LedgerRow} from '../memory/ledgerVerdict.mjs';
import type {BudgetBaselines,BudgetCaps} from '../budgets/files.mjs';

export const NINE_BOOT_KEYS: Readonly<{retained:string;live:string}>;
export interface BootMemoryMark {operation:string;detail:Record<string,unknown>}
export interface BootMemoryVerdict {held:number|null;released:number;retained:number|null;live:number;faults:string[];rows:LedgerRow[]}
export function bootMemoryMarks():BootMemoryMark[];
export function retainedGeometryBytes(scene?:Object3D|null):number|null;
export function bootMemoryVerdict(marks:readonly BootMemoryMark[],retained:number|null,liveBytes:number,judging:{contentKey:string;budgets:{caps:BudgetCaps;baselines:BudgetBaselines}}):BootMemoryVerdict;
export function liveHeapBytes(session:{send:(method:string,params?:object)=>Promise<unknown>}):Promise<number>;
