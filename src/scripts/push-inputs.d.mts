export function sourceInputs(root:string,files:readonly string[]):string[];
export function sourceWalker(root:string,runtimeOnly?:boolean,includeMissing?:boolean):(files:readonly string[])=>string[];
export function liveTests(root:string,tests:readonly string[],products:Record<string,string[]>):string[];
export function liveTestSelection(root:string,tests:readonly string[],products:Record<string,string[]>,changed?:readonly string[]):{run:string[];deferred:{test:string;reason:string}[]};
