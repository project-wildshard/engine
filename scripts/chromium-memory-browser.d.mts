import type {Browser} from 'playwright';

export function memoryNetworkCommand(message:object):object;
export function launchMemoryBrowser(args:readonly string[]):Promise<{browser:Browser;close:()=>Promise<void>}>;
