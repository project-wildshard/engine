import type {GenericSchema} from 'valibot';
import type {Criterion} from './shard-milestones.mjs';

export interface GridReadyLatch {shard:string;criterion:'memory'|'oneFrameLooks';source:string;receiptCommit?:string;receipt?:string;measurement?:{when:string;surface:string;metrics:Record<string,number>};latchedAt:string;quiet?:boolean}
export const GRID_READY_LATCHES:string;
export const GridReadyLatchesSchema:GenericSchema<unknown,{schema:'grid-ready-latches/1';entries:GridReadyLatch[]}>;
export function latchedGridEvidence(root:string,slug:string,revision?:string|null):Partial<Record<'memory'|'oneFrameLooks',Criterion>>;
