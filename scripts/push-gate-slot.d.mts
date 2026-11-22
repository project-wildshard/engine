export const GATE_SERIAL_LOAD:number;
export const GATE_SLOT_POLL_MS:number;
export const GATE_SLOT_MAX_WAIT_MS:number;
export function gateSlot(options?:{load?:()=>number,file?:string,lock?:(file:string,options?:{waitMs?:number})=>(()=>void)|undefined,
 sleep?:(ms:number)=>Promise<void>,log?:(line:string)=>void,now?:()=>number}):Promise<()=>void>;
