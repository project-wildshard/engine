export function openHold(receipts: string): { line: string; landers: string[] } | null;
export function readReceipts(env?: NodeJS.ProcessEnv): string;
export function holdRefusal(push: { lane: string; env?: NodeJS.ProcessEnv; bodies: string; receipts?: string }): string | null;
