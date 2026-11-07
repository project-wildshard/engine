export interface CaptureRpcStage { stage:string;state:'sent'|'received'|'refused'|'unfinished';sequence:number;ms:number }
export function captureRpcObserver(emit:(row:CaptureRpcStage)=>void,now?:()=>number):{line:(line:string)=>boolean;finish:()=>void};
