export const TIMING_RECORDS:readonly string[];
export function pushSelection(refs:string|undefined,cwd?:string,options?:{hosted?:boolean;timingRecords?:boolean}):{mode:'full'|'related'|'docs';files:string[];reason:string};
