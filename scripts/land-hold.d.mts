export function namedPaths(text: string): string[];
export function openHold(receipts: string): { line: string; landers: string[]; paths: string[] } | null;
export function touching(files: readonly string[], paths: readonly string[]): string[];
export function readReceipts(env?: NodeJS.ProcessEnv): string;
export function holdRefusal(push: { lane: string; env?: NodeJS.ProcessEnv; bodies: string; receipts?: string; files?: readonly string[]; say?: (line: string) => void }): string | null;
