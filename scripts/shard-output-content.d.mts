import type {OutputReader} from './shard-platform-output.mjs';

export interface OutputContent {status:'built';product:string;privateBinaries:string[];privateBinaryBytes:number;tiles:{total:number;l0:number;l1:number};gate:{enforcement:'report-only';status:'candidate'|'incomplete';issues:string[]}}
export function outputContent(root:string,slug:string,products:string,reader?:OutputReader):OutputContent;
