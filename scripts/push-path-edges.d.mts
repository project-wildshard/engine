export interface PathEdge {why:string;pattern:RegExp;tests?:readonly string[];static?:string;ring?:boolean}
export interface CheckTask {name:string;commands:string[][]}
export const FS27_STATIC:readonly CheckTask[];
export const TABLE_TESTS:readonly string[];
export const PATH_EDGES:readonly PathEdge[];
export function edgeTests(changed:readonly string[]):string[];
export function urlReaderTests(changed:readonly string[],cwd?:string):string[];
export function movedRingSlugs(before:{pins?:unknown;digests?:unknown},after:{pins?:unknown;digests?:unknown},platform:string):string[];
export const SIM_STATE:RegExp;
export function simRingSlugs(changed:readonly string[],digests:unknown,platform:string):string[];
export function pinChanges(refs:string|undefined,cwd:string,platform?:string):{pins:string[];ring:string[]};
export function fs27Plan(selection:{mode:'full'|'related'|'docs';files:string[]},options:{split:boolean;slugs:readonly string[];cwd?:string}):{tasks:CheckTask[];tests:string[]};
