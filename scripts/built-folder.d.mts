import type { InputHashMemo } from './bake-input-hashes.mjs';

/** Shared closed-runtime admission; reading never invokes a build. */
export function runtimeCopyIssues(root:string,project:string):{file:string;message:string}[];
/** Builder and read-only lookup use identical copy/map/output flags. */
export function folderFlags(root:string,output:string|undefined,map:{image?:string;tilesHash:string}|undefined,copy:boolean):string[];
/** Exact normalized recipe namespace used by sealed product input receipts. */
export function folderRecipe(root:string,name:string,flags:string[],toolchain:string,cacheRoot:string):{normalized:string[];recipe:string[];receipts:string};
/** Retain an original sealed input receipt as unshipped slot metadata; readers still replay its complete freshness proof. */
export function retainFolderInputs(root:string,name:string,receipt:string,key:string,recipe:string[],memo:InputHashMemo):void;
/** Read an exact-SHA CI product or a matching sealed local product, retaining cache lifetime pins. Never generates or builds. */
export function readBuiltShardfile(root:string,name:string,options?:{cacheRoot?:string;env?:NodeJS.ProcessEnv}):string;
/** Partition suites by the same verified product intake, without building or admitting stale products. */
export function selectBuiltTestFolders(root:string,files:readonly string[],options?:{cacheRoot?:string;env?:NodeJS.ProcessEnv}):{ready:string[];blocked:string[];missing:string[];buildCommand:string|undefined};
/** Check only selected product suites before worker setup, without building or accepting stale products. */
export function assertBuiltTestFolders(root:string,files:readonly string[],options?:{cacheRoot?:string;env?:NodeJS.ProcessEnv}):void;

/** Source-program maps use current world inputs; legacy maps retain their image/pixel stamp. */
export function folderMapInput(project:string,output:string|undefined):{image?:string;tilesHash:string;pixelHash?:string}|undefined;

/** Materialize the compatibility public map alias from verified generated-product bytes and source identity. */
export function publishFolderMap(root:string,name:string,folder:string,expectedSourceHash:string):Promise<void>;
