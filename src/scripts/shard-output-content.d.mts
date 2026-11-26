import type {OutputReader} from './output-reader.mjs';

export interface OutputContent {status:'built';product:string;privateBinaries:string[];privateBinaryBytes:number;tiles:{total:number;l0:number;l1:number};gate:{enforcement:'report-only';status:'candidate'|'incomplete';issues:string[]}}
export function outputContent(root:string,slug:string,products:string,reader?:OutputReader):OutputContent;
