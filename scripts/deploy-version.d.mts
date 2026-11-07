/** Original short/full SHA identity used by historical releases. */
export function matchesCommit(build:unknown,commit?:string):boolean;
/** The original response also matches the immutable staged BUILD, if supplied. */
export function matchesDeployment(build:unknown,commit:string,expected:string|undefined):boolean;
