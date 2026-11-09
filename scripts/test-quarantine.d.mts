export interface QuarantineExtension {readonly reason:string;readonly grantedAt:string;readonly decidedBy:string;readonly deadline:string}
export interface QuarantineEntry { readonly file: string; readonly owner: string; readonly addedAt: string; readonly deadline: string; readonly reason: string; readonly extension?:QuarantineExtension }
export function readQuarantine(file?:string|URL): QuarantineEntry[];
export function activeQuarantineFiles(now?: number): string[];
export function assertQuarantineHistory(root?:string):QuarantineEntry[];
export function quarantineDeadline(entry:Pick<QuarantineEntry,'deadline'|'extension'>):string;
