export interface BrowserAdmissionLease {lost:Promise<void>;release:()=>Promise<void>}
export function installBrowserAdmission(type:object,acquire:()=>Promise<BrowserAdmissionLease>,onFailure?:(error:unknown,context?:{lost:boolean})=>void):void;
