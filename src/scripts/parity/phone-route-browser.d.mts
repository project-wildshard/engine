import type {PhonePage,PhoneDocument} from './phone-route.mjs';
import type {Inspector} from '../soak/inspector.mjs';

export function phoneBootstrap(paintScript:string,visit?:string):string;
export function phoneDocumentMatches(value:unknown,url:string,previous:PhoneDocument):boolean;
export function phonePageTarget(list:unknown,url:string):{url:string;webSocketDebuggerUrl:string}|undefined;
export function runNativePhoneCommand(args:string[],execute?:(command:string,args:string[],options:{encoding:'utf8';timeout:number})=>string):string;
export interface NativePhonePorts {
  udid?:string;
  command?:(args:string[])=>string;
  proxy?:(socket:string)=>{kill:(signal?:NodeJS.Signals)=>boolean};
  inspector?:(url:string)=>Pick<Inspector,'opened'|'send'|'close'|'waitForPageTarget'>;
  targets?:(port:number)=>Promise<unknown>;
  close?:()=>void;
}
export function openPhoneBrowser(engine:string,base:string,out:string,native?:NativePhonePorts):Promise<PhonePage>;
/** Capture the real native WebKit viewport within the original ten-second cap. */
export function captureNativePhonePage(inspector:Pick<Inspector,'send'>,path:string):Promise<Buffer>;
/** Follow the provisional target without retiring its owned bootstrap. */
export function followNativePhoneDocument(inspector:Pick<Inspector,'send'>,url:string,previous:PhoneDocument,deadline:number):Promise<void>;
