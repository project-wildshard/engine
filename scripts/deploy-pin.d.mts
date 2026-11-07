/** Latest real built-dist boot status for this exact SHA; older successes cannot override newer failures. */
export function bootGreen(sha: string, query?: (args: string[]) => string): boolean;
/** Refuse automatic promotion behind or outside the live production ancestry; return its resolved full SHA. */
export function productionFloor(build: string, candidate: string, query?: (args: string[]) => string): string;
/** Numeric run endpoint resolved from the workflow's exact path, cached per API client. */
export function workflowRunsPath(workflow: 'deploy.yml' | 'boot-smoke.yml', query?: (args: string[]) => string): string;
/** Select the newest successful push CI that also passed a real boot on the exact same SHA. */
export function newestCiGreen(query?: (args: string[]) => string, log?: (line: string) => void, now?: number): string;
/** Bind an exact historical pin to a version successfully read from production in its release job. */
export function logProvesProduction(sha: string, log: string): boolean;
/** Prove a build was previously live, using its verified status or historical successful release logs. */
export function productionLive(sha: string, query?: (args: string[]) => string): boolean;
/** Whether this exact commit already passed the complete main push-CI workflow. */
export function ciGreen(sha: string, query?: (args: string[]) => string): boolean;
/** Successful exact main push producer of the prebuilt artifact. */
export function ciSourceRun(sha: string, query?: (args: string[]) => string): string;
/** Explicit completed main source proof; failed shipping never waives a source gate. */
export function recoverySource(runId: string, query?: (args: string[]) => string): {sha:string;run:string};
/** Explicit prebuilt backstop after terminal shipping failure or thirty queued minutes. */
export function readySource(runId:string,liveBuild:string,query?:(args:string[])=>string,now?:number):{
  sha:string;run:string;authority:string;reason:string;verifiedAt:string;liveBuild:string;
  aggregate:{status:string;conclusion:string|null};
  jobs:{name:string;status:string;conclusion:string}[];
  failures:{name:string;status:string;conclusion:string}[];
  bootPublishRequired:boolean;bootAlreadyPublished:boolean;sixCompletedAt:string|null;runAttempt:number|null;
};
/** Explicit manual publisher after exact archive restore and re-admission; never emits deployment outputs itself. */
export function completeReadySource(selected:ReturnType<typeof readySource>,restore:(proof:ReturnType<typeof readySource>)=>string,recheck:()=>ReturnType<typeof readySource>,query?:(args:string[])=>string):ReturnType<typeof readySource>&{prebuiltArchive:string|null;bootPublished:boolean};
/** Validate the exact prebuilt archive in a controller-owned directory that survives selected-source checkout. */
export function stageReadyArchive(proof:{sha:string;run:string},runnerTemp:string,run?:(command:string,args:string[])=>void):string;
/** G917 manual deadline exception, retaining every actual completed verdict. */
export function deadlineRecoverySource(runId:string,query?:(args:string[])=>string,now?:number):{
  sha:string;run:string;
  jobs:{name:string;status:string;conclusion:string}[];
  failures:{name:string;status:string;conclusion:string}[];
};
/** Explicit exact-run proof, including a stuck aggregate only when all 16 required jobs succeeded. */
export function ciRunGreen(sha: string, runId: string, query?: (args: string[]) => string): boolean;

/** Bind trusted same-run wave results before that run's own ship job completes. */
export function waveSource(input: {mode:string;event:string;ref:string;repository:string;sha:string;run:string;head:string;needs:unknown;bootOutcome?:string|undefined;staged?:boolean|undefined}): {skip:boolean;sha:string;run:string};


/** No CI-green candidate has a successful exact-SHA smoke yet. */
export class PendingBootSmokeError extends Error { constructor(sha: string); sha: string; }
/** Select an existing BOTH-proof-green pin immediately; wait only when no candidate has both proofs. */
export function newestCiGreenAfterBoot(query?: (args: string[]) => string, log?: (line: string) => void, options?: { now?: () => number; wait?: (ms: number) => Promise<void>; maxWaitMs?: number }): Promise<string>;

/** Dispatch the newest candidate with both proofs, even while newer smoke is pending; API errors remain fatal. */
export function releaseReady(query?: (args: string[]) => string, log?: (line: string) => void, now?: number): { ready: boolean; sha: string };
