import type { DiscoveryValues } from '@wildshard/format/discoveryValues';
/** Inspect existing metadata without loading generator/build capabilities. */
export function usesProgramDiscovery(metadata:unknown):boolean;
/** Checked values from a current product receipt, without generator or stale-file fallback. */
export function readProgramDiscovery(root:string,name:string,options?:{cacheRoot?:string;env?:NodeJS.ProcessEnv}):DiscoveryValues;
