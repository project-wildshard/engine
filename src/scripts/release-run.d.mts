export function openReleaseRun(root: string, label: string): { work: string; proof: string; close: () => void };
export function keepReleaseProof(work: string, proof: string, files: readonly string[]): void;
