export const WALK_RATCHET: URL;
export interface Held {value:number;spread:number;judged:boolean;why?:string}
export interface WalkBaseline {version:2;mode:'walk';boot:'online';zone:string;seconds:number;runs:number;source:string;rate:Held;peak:Held}
export interface Read {median:number;min:number;max:number;n:number}
export interface WalkSummary {complete:boolean;bytesPerSecond:Read;peakAboveSettled:Read}
export function parseWalkBaseline(value:unknown):WalkBaseline;
export function walkBaseline():WalkBaseline;
export function rateLine(baseline:WalkBaseline):number;
export function peakLine(baseline:WalkBaseline):number;
export function compareWalk(baseline:WalkBaseline,summary:WalkSummary):string|null;
export function walkVerdict(baseline:WalkBaseline,first:WalkSummary,again:WalkSummary|null):{state:'pass'|'spike'|'fail';failure:string|null};
export function bimodal(values:readonly number[]):boolean;
export function reportedLines(baseline:WalkBaseline,summary:WalkSummary,peaks:readonly number[]):string[];
export function repinWalk(baseline:WalkBaseline,summary:WalkSummary,source:string):WalkBaseline;
