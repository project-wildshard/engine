export function authorBundleCached(root:string,recipe:string[],compile:()=>Promise<{code:string,modules:string[]}>,cacheRoot?:string):Promise<{code:string,modules:string[],reused:boolean}>;
