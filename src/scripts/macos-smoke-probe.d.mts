export interface CommandResult {code:number|null;signal:NodeJS.Signals|null;timedOut:boolean;cancelled:boolean;error:string|null;wallMs:number}
export interface SmokeCase {mode:string;shard:string;developer:unknown;elapsedMs:number;gameplayFrames:{initial:number;final:number};faults:unknown[];fatal:unknown[];renderer:{renderer:string;unmaskedRenderer?:string|null;lost:unknown}}
export interface RendererReport {schema:string;error:string|null;cancelled:string|null;expected:unknown[];cases:SmokeCase[]}
export function stockProofCommand(out:string,report:string,platform?:string,buildRoot?:string):string[];
export function hostedAdmission(env:NodeJS.ProcessEnv):string;
export function smokeVerdict(exit:CommandResult,report:RendererReport|null,products:readonly string[]):{verdict:string;reason?:string;under60Seconds?:boolean;renderers?:string[]};
export function runCommand(command:string[],options:{cwd:string;env?:NodeJS.ProcessEnv;log:string;timeoutMs?:number;killAfterMs?:number}):Promise<CommandResult>;
export function proofIdentity(root:string):{sha:string;files:Record<string,string>;products:string[]};
