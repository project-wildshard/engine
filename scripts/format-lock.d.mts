export function isFormatLockInput(path: string): boolean;
export function formatLockFailures(read: (path: string) => string | undefined, workflows?: readonly string[]): string[];
export function formatTagFailures(
  read: (path: string) => string | undefined,
  readTag?: (repo: string, tag: string) => { commit: string; name: string; version: string },
): string[];
