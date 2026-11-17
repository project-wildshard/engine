import type {Browser} from 'playwright';

export const NINE_READY_TIMEOUT_MS:number;

export function assertNineLoad(browser:Browser,base:string,out:string):Promise<void>;
