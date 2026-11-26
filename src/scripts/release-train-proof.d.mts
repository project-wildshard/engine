interface Job { name: string; conclusion: string; status: string }
export interface Run {
  databaseId: number; headSha: string; status: string; conclusion: string; jobs: Job[];
  workflowName?: string; event?: string; headBranch?: string; displayTitle?: string;
}
export interface Alias { build?: string; channel?: string; serial?: number; deployment?: { id?: string } }
export interface Leg { build?: string; release?: string; kind?: string; status?: string; hold?: boolean; roomsSerial?: number; deploymentId?: string }

export const trainSha: RegExp;
export const trainTag: RegExp;
export function watchTrainRun(id: number, watch: () => Promise<void>, readRun: (id: number) => Run): Promise<Run>;
export function provesNpmNext(run: Run, build: string): boolean;
export function nextAdmission(build: string, tag: string, ci: number, alias?: Alias, candidate?: Leg):
  { staging_build: string; staging_qualification: string } | undefined;
export function provesTrainCi(run: Run, build: string): boolean;
export function provesReleaseReuse(run: Run, build: string, tag: string, cut: string, cwd: string): boolean;
export function attributionGap(env: Record<string, string | undefined>, prepared: boolean): string | undefined;
export function retryRead<T>(read: () => T, opts?: {tries?: number, pauseMs?: number, pause?: (ms: number) => void}): T;
export function fullCommitArgs(args: readonly string[]): readonly string[];
export function localAttemptDir(saved: string, held: (dir: string) => boolean): string;
export function releaseCiAdmission(build: string, ci: number): { staging_build: string; staging_qualification: string };
export function gateInputsMoved(log: string): boolean;
export function cutTree(root: string, sha: string, dir: string): string;
