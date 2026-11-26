export interface CheckerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export interface IndexResult {
  changed: number;
  commitBytes: number;
  pushBytes: number;
  weekBytes: number;
  weekOver: boolean;
  maxPushBytes: number;
  maxWeeklyBytes: number;
}

export interface PushResult {
  commits: number;
  pushBytes: number;
  weekBytes: number | null;
  weekOver: boolean;
}

export interface TreeResult {
  rev: string;
  files: number;
  bytes: number;
  legacyFiles: number;
  legacyBytes: number;
  migrationBase: string | null;
}

export interface Checker {
  checkIndex: () => IndexResult;
  checkPush: (input: string, options?: { rangeOnly?: boolean }) => PushResult;
  checkTree: (rev: string, options?: { strict?: boolean }) => TreeResult;
}

export function isRuntime(path: string): boolean;
export function isText(path: string): boolean;
export function isCounted(path: string): boolean;
export function createChecker(options?: CheckerOptions): Checker;
export function main(argv?: string[]): number;
