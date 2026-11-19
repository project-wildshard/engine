export const WALK_RATCHET: URL;
export interface Held {value:number;allowance:number;spread:number}
export interface WalkBaseline {version:1;mode:'walk';boot:'online';zone:string;seconds:number;runs:number;source:string;rate:Held;peak:Held}
export function parseWalkBaseline(value:unknown):WalkBaseline;
export function walkBaseline():WalkBaseline;
export function compareWalk(baseline:WalkBaseline,summary:{complete:boolean;bytesPerSecond:{median:number;n:number};peakAboveSettled:{median:number;n:number}}):string|null;
export function repinWalk(baseline:WalkBaseline,summary:{bytesPerSecond:{median:number;min:number;max:number};peakAboveSettled:{median:number;min:number;max:number}},source:string):WalkBaseline;
