/** Current sealed G-key reachability over declared project-step cache roots only. */
export interface GenerationCacheReport {
  qualified:boolean;reason:string;dryRun:boolean;products:number;keys:number;
  files:number;bytes:number;referencedEntries:number;referencedFiles:number;referencedBytes:number;
  historyEntries:number;historyFiles:number;historyBytes:number;retainedFiles:number;retainedBytes:number;
  unknownEntries:number;removedEntries:number;removedFiles:number;removedBytes:number;milliseconds:number;
}
/** Defaults to read-only. The CI caller alone owns isolated-runner mutation. */
export function trimGenerationCache(sourceRoot:string,cacheRoot:string,genRoot:string,fallback:string,
  options?:{env?:NodeJS.ProcessEnv,dryRun?:boolean,seconds?:number}):GenerationCacheReport;
