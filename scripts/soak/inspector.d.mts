/** Scalar and target-aware Web Inspector transport shared by native readers. */
export interface InspectorSocket {
  once: ((event:'open',listener:()=>void)=>void) & ((event:'error',listener:(error:Error)=>void)=>void);
  on: ((event:'message',listener:(data:{toString:()=>string})=>void)=>void) & ((event:'close'|'error',listener:()=>void)=>void);
  send:(message:string)=>void;
  close:()=>void;
}
export type InspectorSocketConstructor = new(url:string,options:{maxPayload:number})=>InspectorSocket;
export interface Inspector {
  readonly opened:Promise<unknown>;
  /** Resolve after Safari announces its page target, within the caller budget. */
  waitForPageTarget:(timeout?:number)=>Promise<void>;
  send:(method:string,params?:Record<string,unknown>)=>Promise<unknown>;
  on:(method:string,listener:(params:unknown)=>void)=>()=>void;
  close:()=>void;
  evaluate:(expression:string)=>Promise<unknown>;
}
export function soakInspector(url:string,Socket?:InspectorSocketConstructor):Inspector;
