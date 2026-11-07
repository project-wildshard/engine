export interface CulpritReport {
  base:string;sha:string;files:string[];
  candidates:{sha:string;subject:string;assistedBy:string;match:'failing file'|'literal import'}[];
  missingImports:string[];
}
/** Select only a completed green main push created before the exact failed run. */
export function priorGreen(sha:string,query?:(path:string)=>unknown):string;
/** Inspect literal imports in both immutable trees and return at most three related commits. */
export function culpritReport(root:string,base:string,sha:string,files:string[]):CulpritReport;
/** Fetch bounded immutable history for a shallow diagnostic checkout. */
export function prepareHistory(root:string,sha:string):void;
