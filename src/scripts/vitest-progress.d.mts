export const SLOW_FILE_SECONDS:number;
export function expectedSuiteSeconds(table:Record<string,number>|undefined,workers:number):number|null;
export default class VitestProgress {
  constructor();
  onInit(vitest:{config:{root:string}}):void;
  onTestModuleStart(module:{moduleId:string}):void;
  onTestModuleEnd(module:{moduleId:string;state:()=>string}):void;
}
export interface ProgressRow {file:string;seconds:number}
export function progressSummary(text:string,now?:number,top?:number):{running:ProgressRow[];slowest:ProgressRow[];finished:number};
export function progressReport(path:string|undefined,now?:number):string;
