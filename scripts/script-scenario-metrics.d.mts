import type {DecisionTrace} from '../src/server/engine/script/decision';

export interface ScriptScenarioReceipt {schema:'script-scenario/1';slug:string;script:string;scenario:string;sectionHash:string;hostHash:string;passed:true;calls:number;fuel:number;maxFuel:number;refusals:number}
export function scriptScenarioReceipt(input:{slug:string;script:string;scenario:string;sectionHash:string;hostHash:string;trace:readonly DecisionTrace[]}):ScriptScenarioReceipt;
export function scenarioHostHash(root:string):string|null;
export function scriptReceiptPaths(root:string):string[];
export function scriptScenarioMetrics(slug:string,index:{sections:{name:string;path:string;hash:string}[]},read:(path:string)=>Uint8Array,paths:readonly string[],hostHash:string|null):{
 status:string;scripts:{id:string;measured:boolean}[];scenarios:(ScriptScenarioReceipt&{path:string;receiptHash:string})[];
};
export function productScriptMetrics(root:string,slug:string,products:string,paths:readonly string[]):ReturnType<typeof scriptScenarioMetrics>;
