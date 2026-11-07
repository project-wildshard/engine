/** Post-generation transport identity; incomplete evidence retains the legacy save. */
export function preparationCacheKey(root:string,fallback:string,options?:{cacheRoot?:string,env?:NodeJS.ProcessEnv}):{key:string,qualified:boolean,products:number,reason:string};
