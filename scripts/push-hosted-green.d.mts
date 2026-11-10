export const LANDING_WORKFLOWS: Readonly<Record<'ci'|'ring-1',string>>;
export type LandingRuns = Record<string,{id:number;status:string;conclusion:string|null}>;
export function githubSlug(remote:string):string|null;
export function landingVerdict(data:unknown,sha:string):{state:'pending'|'green'|'red';runs:LandingRuns};
export function codeProvingJobs(data:unknown):boolean;
export function hostedGreen(sha:string,remote:string,api?:(path:string)=>unknown,root?:string):LandingRuns|null;
