import type {Value, RecordValue} from './value.mjs';

export interface Verdict {field:string;baseline:Value|undefined;now:Value|undefined;band:string;verdict:string;class:string}
export interface CompareOptions {pending?:RecordValue[];quarantine?:RecordValue[];renames?:RecordValue[];ambientInfo?:string[];lanePending?:boolean;now?:string;ignore?:string[]}
export function captureIgnore(only: string | undefined, fast?: boolean): string[];
export function matches(pattern: string, path: string): boolean;
export function renameBaseline(b:RecordValue,n:RecordValue,maps:RecordValue[]):RecordValue;
export function normalize(value:RecordValue):RecordValue;
export function validateQuarantine(entries:RecordValue[],today:string):string[];
export function compare(b:RecordValue,n:RecordValue,options?:CompareOptions):{verdict:string;rows:Verdict[]};
