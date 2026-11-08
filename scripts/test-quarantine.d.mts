export interface QuarantineEntry { readonly file: string; readonly owner: string; readonly deadline: string; readonly reason: string }
export function readQuarantine(): QuarantineEntry[];
export function activeQuarantineFiles(now?: number): string[];
