import type {execFileSync} from 'node:child_process';
import type {PackStore} from './flow.mjs';

export function serverPackOutputRoot(root: string, bookPath: string): string;
export function r2Packs(options: {log: (line: string) => void; exec?: typeof execFileSync; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>}): PackStore;
