import type {CustomSource} from './shard-platform.mjs';

export interface ListedViewEntry {path:string;name?:string;reason:string;decision:string}
export interface ListedViewRegister {schema:1;shards:Record<string,ListedViewEntry[]>}
export interface ListedViewInventory {totalCustomLines:number;listedViewLines:number;otherCustomLines:number;register:(ListedViewEntry&{matched:boolean;lines:number})[]}
export function loadListedViews(root:string):ListedViewRegister;
export function listedViewInventory(root:string,slug:string,sources:readonly CustomSource[],total:number,rows?:ListedViewRegister):ListedViewInventory;
