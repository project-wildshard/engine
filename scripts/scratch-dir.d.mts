export interface ScratchOwner {
  task: string;
  session: string | null;
  lane: string | null;
  pane: string | null;
  started: string;
  purpose: string;
}

export function refuseTask(task: unknown): string | null;
export function ownerRecord(task: string, purpose: string, env: NodeJS.ProcessEnv, now: Date): ScratchOwner;
export function scratchDir(task: string, purpose: string, options?: {
  root?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): string;
