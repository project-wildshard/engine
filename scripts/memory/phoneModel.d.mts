export interface Range {low:number;central:number;high:number}
export interface TraceWindow {step:string;peak:{webcontent:number;gpu:number}}
export interface ChainModel {gpuFloorMB:number;alpha:{low:number;high:number};scale:{low:number;high:number}}
export interface LedgerFit {webcontent:{floorMB:number;perMB:number};gpu:{floorMB:number;perMB:number};missPct:number}
export interface PhoneModel extends ChainModel {
  limitMB:number;limitHighMB:number;ledger:LedgerFit;peakOverSettled:Range;chromium:{loadingPerRenderer:Range};
  anchor?:unknown;instrument?:string;zones?:Record<string,{phonePlayingMB:Range;phoneLoadingMB:Range}>;
}
export function loadPhoneModel():PhoneModel;
export function anchorBounds(windows:readonly TraceWindow[],lastOperation:string,options:{limitMB:number;limitHighMB:number;gpuFloorMB:number}):{
  alpha:{low:number;high:number};scale:{low:number;high:number};died:{step:string;webcontentMB:number;gpuMB:number};lived:{step:string;webcontentMB:number;gpuMB:number};consistent:boolean};
export function phoneFromWebKit(k:{webcontent:number;gpu:number},model:ChainModel):Range;
export function phonePeakFromWebKit(checkpoints:readonly {peak:{webcontent:number;gpu:number}}[],model:ChainModel):Range;
export function ledgerSplit(counters:Record<string,Record<string,number>>|null|undefined):{ram:number;gpu:number};
export function phoneFromLedger(counters:Record<string,Record<string,number>>|null|undefined,model:ChainModel&{ledger:LedgerFit;peakOverSettled:Range},phase?:'playing'|'loading'):Range;
export function phoneFromChromium(rendererBytes:number,model:{chromium:{loadingPerRenderer:Range}}):Range;
export function rangeText(range:Range):string;
export function t90(df:number):number;
export function upperOverRuns(highs:readonly number[]):number;
export function zoneOverRuns(runs:readonly {settled:{webcontent:number;gpu:number};checkpoints:readonly {peak:{webcontent:number;gpu:number}}[]}[],model:ChainModel):{
  runs:number;playing:{central:number;upper:number};loading:{central:number;upper:number}};
