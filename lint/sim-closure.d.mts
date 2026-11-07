export interface SimViolation { id: string; count: number; trace: string[] }
export function simRoot(path: string): boolean;
export function simClosure(root: string, entries?: string[]): SimViolation[];
