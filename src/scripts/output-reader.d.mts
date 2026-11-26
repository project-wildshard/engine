import type {OutputIndex} from '@wildshard/format/outputIndex';
import type {Shardfile} from '@wildshard/format/shardSchema';

/** Hash/size-verified sections for data-selected G294 users, even before runtime closure. */
export function outputSections(root:string,slug:string,products?:string):{index:OutputIndex;sections:{name:string;value:unknown}[];customSections:{name:string;bytes:number;jsonSchema?:unknown}[];customSectionBytes:number};

/** Report-scoped reader for an immutable output tree; create afresh for each report. */
export interface OutputReader {
  sections:(slug:string)=>ReturnType<typeof outputSections>;
  source:(slug:string)=>Shardfile;
}
export function createOutputReader(root:string,products?:string):OutputReader;
