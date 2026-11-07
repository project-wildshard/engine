import type { parseSync } from 'vite';

export interface DebugFlag { id: string; ask: string; reviewBy: string; file?: string; purpose?: 'developer' }
export function debugFlags(root: string, cacheDir?: string): DebugFlag[];
export function declaredDebugRows(program: ReturnType<typeof parseSync>['program']): unknown[];
