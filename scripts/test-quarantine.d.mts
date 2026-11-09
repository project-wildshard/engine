export interface QuarantineEntry { readonly file: string; readonly owner: string; readonly addedAt: string; readonly deadline: string; readonly reason: string }
export function readQuarantine(file?:string|URL): QuarantineEntry[];
export function activeQuarantineFiles(now?: number): string[];
export function assertQuarantineHistory(root?:string):QuarantineEntry[];
