/** Refuse actual byte objects before serialization obscures their type. */
export function assertJsonRows(value:unknown,path?:string):void;
/** Validate the full policy and retain only declared output-path allowances. */
export function jsonOutputPolicy(directory:string,outputs:readonly string[]):string|undefined;
/** The producer's exact-path binary JSON policy, applied before publication. */
export function jsonOutputGuard(directory?:string):(file:string,bytes:Uint8Array|string)=>void;
