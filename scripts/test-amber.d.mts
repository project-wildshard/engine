export interface AmberEntry {since:number;runs:number;ms:number;run:string;clean?:number}
export type AmberLedger = Record<string,AmberEntry>;
export interface AmberLimits {budgetMs:number;redFactor:number;redAfterHours:number;redAfterRuns:number;clearAfterRuns:number}
export interface AmberVerdict {file:string;ms:number;budget:number;level:'ok'|'amber'|'red';why:string;entry?:AmberEntry}
export const AMBER: Readonly<AmberLimits>;
export function readLedger(value:unknown):AmberLedger;
export function judgeFile(file:string,ms:number,budget:number,entry:AmberEntry|undefined,now:number,limits?:AmberLimits):AmberVerdict;
export function amberLine(verdict:AmberVerdict,run:string|null|undefined):string;
export function parseAmber(text:string):{file:string;ms:number;budget:number}[];
export function nextLedger(previous:AmberLedger|undefined,files:readonly {file:string;durationMs:number}[],options:{run:string;at:number;inventory:Set<string>|null;budget?:number}):AmberLedger;
export function judgeWall(shard:string,ms:number,budget:number,limits?:AmberLimits):AmberVerdict;
export function parseAudioAmber(text:string):{shard:string;tier:string;bytes:number;budget:number;red:number;level:string}[];
