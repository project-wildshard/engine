export const AUTHOR_BUNDLE_USE_PREFIX:string;
/** Opt-in successful-use row; unknown calling contexts remain explicit. */
export function authorBundleUseLine(root:string,cacheRoot:string,namespace:string,key:string,args?:readonly string[],env?:NodeJS.ProcessEnv):string|undefined;
