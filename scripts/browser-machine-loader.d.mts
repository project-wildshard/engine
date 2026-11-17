interface BrowserPolicyRecord {bytes:string;uid:number;mode:number;regular:boolean}
interface BrowserMachineLease {proof:{lease:string;slots:number;capacity:number;queueSeconds:number};pid:number|undefined;parentContext?:string;lost:Promise<void>;release:()=>Promise<void>}
interface BrowserMachineProvider {install:(playwright:object)=>void|Promise<void>;reserve?:()=>Promise<BrowserMachineLease>}
interface BrowserMachineOptions {path?:string;uid?:number;read?:(path:string)=>Promise<BrowserPolicyRecord>;load?:(url:string)=>Promise<unknown>}
declare function installMachineBrowserAdmission(playwright:object,options?:BrowserMachineOptions):Promise<boolean>;
declare function reserveMachineBrowserAdmission(options?:BrowserMachineOptions):Promise<BrowserMachineLease|undefined>;
declare function admittedPlaywright<Namespace extends object>(playwright:Namespace):Promise<Namespace>;
export{type BrowserPolicyRecord,type BrowserMachineOptions,type BrowserMachineLease,type BrowserMachineProvider,installMachineBrowserAdmission,reserveMachineBrowserAdmission,admittedPlaywright};
