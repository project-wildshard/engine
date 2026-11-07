import type {Criterion} from './shard-milestones.mjs';

export function runtimeReceiptPaths(root:string):string[];
export function runtimeGridEvidence(root:string,slug:string,revision:string|null,paths:readonly string[],caps:{explorerMB:number;loadingMB:number},includeLatches?:boolean):Partial<Record<'memory'|'oneFrameLooks'|'frameFloor',Criterion>>;
