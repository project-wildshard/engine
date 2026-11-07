/** Exact installed executable used by the native trusted-input control. */
export function nativeChromeExecutable():string;
/** Untimed complete file reads; no launch, profile, flags or file writes. */
export function warmNativeChrome(executable:string):Promise<{
  executable:string;binary:string;files:{path:string;bytes:number}[];bytes:number;
}>;
