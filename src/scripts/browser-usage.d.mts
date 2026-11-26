export const BROWSER_CORES: number;
export interface LedgerRow {token?:string;slots?:number;borrowedFrom?:string|null;browser?:boolean;browserWeight?:number;holder?:number}
export function reservedSlots(active:readonly LedgerRow[]):number;
export function browserSlots(ledger:{capacity:number;active:readonly LedgerRow[];outside:number}):number;
export function browserStatus():{total:number;slots:number;holders:number[];outside:number[]};
export function browserUsage():number;
