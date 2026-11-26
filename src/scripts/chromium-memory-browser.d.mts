import type {Browser} from 'playwright';

export function memoryNetworkCommand(message:object):object;
export function devToolsEndpoint(file:string,waitMs?:number):Promise<[string,string]>;
export function launchMemoryBrowser(args:readonly string[]):Promise<{browser:Browser;close:()=>Promise<void>}>;
