export const RECORDED_BAKES: readonly { file: string; script: string; bake: string }[];
export function isRecordedBake(file: string): boolean;
export function bakeOutcome(text: string): string;
export function refreshBakeInputs(root: string): Promise<Record<string, string>>;

/** Exact SHA256 input map; nonregular and absent files refuse generation. */
export function bakeInputHashes(root:string,paths:Iterable<string>,memo?:InputHashMemo):Record<string,string>;

/** Exact stat-validated hashes. Optional phase snapshots verify frozen bytes/inventories at completion and before cold publication. */
export class InputHashMemo {
  constructor(root:string,file?:string);
  readonly root:string; readonly reads:number;
  readonly snapshot:boolean;
  hash(path:string,fresh?:boolean):string;
  enableSnapshot(ignore:(file:string)=>boolean):void;
  paths(path:string,fresh?:boolean,nested?:boolean):string[];
  verifyInputs(inputs:Record<string,string>):void;
  verifySnapshot():void;
  snapshotData():{inputs:Record<string,string>;trees:Record<string,string[]>};
  flush():void;
}
