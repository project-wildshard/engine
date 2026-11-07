export function exportTree(root:string,sha:string):{tree:string;cleanup:()=>void};
export function serve(tree:string,sha:string,built?:boolean):Promise<{url:string;close:()=>void}>;
export function previewReady(url:string,timeoutMs?:number):Promise<boolean>;
export function readJson(path:string):unknown;
export function runtimeTree(root:string,sha:string):string;
export function cachedTree(root:string,sha:string,cacheRoot?:string,build?:(tree:string,sha:string)=>void|Promise<void>):Promise<{
  tree:string;fixtures:string;hit:boolean;key:string;cleanup:()=>void;
}>;
