/** An import that prevents an authoring-only bake; the immediate importer makes its owner explicit. */
export interface AuthoringIssue {file:string;from:string|null;reason:'outside-authoring'|'missing'|'symlink'|'computed-import'|'glob-import'|'unresolved-import'}
/** The statically closed producer inputs, with explicit refusals instead of guessed dynamic dependencies. */
export interface AuthoringAudit {entry:string;files:string[];issues:AuthoringIssue[]}
/** Classify shard-owned authoring source and the SDK/commons, excluding trusted runtime and legacy. */
export function isAuthoringInput(file:string,shard:string):boolean;
/** Walk literal static/dynamic/type imports through defining package exports without executing their code. */
export function auditAuthoringInputs(root:string,shard:string,entry:string):AuthoringAudit;
