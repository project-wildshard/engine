export interface RuntimeClosure {status:'closed'|'unclosed';escapes:number;files:{path:string;count:number;messages:string[]}[];refusal?:string}
/** Raw P0 escape inventory; no source code percentage or baseline allowance. */
export function runtimeClosures(root:string):Record<string,RuntimeClosure>;
