export interface Mirror {
  dir: string;
  sha: string;
  release: () => void;
}

export interface MirrorOptions {
  repo?: string;
  slot?: string;
  full?: boolean;
  env?: NodeJS.ProcessEnv;
  linkModules?: boolean;
  /** Absolute wall deadline; never extends the five-minute queue bound. */
  deadline?: number;
}

export function mirrorRoot(env?: NodeJS.ProcessEnv, repo?: string): string;
export function openMirror(rev: string, options?: MirrorOptions): Mirror;
/** Only the official commit wrapper's private candidate index is admitted. */
export function openStagedMirror(repo: string, options?: MirrorOptions): Mirror & { tree: string };

export function scratchCaller(path: string, repo?: string): boolean;
export function assertMirrorCaller(): void;
export function mainMirrorRevision(rev: string, repo?: string): string;
