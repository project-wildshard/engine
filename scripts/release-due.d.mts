export interface ReleaseCut { tag: string; build: string; cutAt: string; newCommits: number }
export interface ReleaseDue extends ReleaseCut {
  status: 'no-change' | 'waiting' | 'due' | 'overdue';
  nextWindow: { opens: string; closes: string };
  onDemand: boolean;
}
export function releaseDue(latest: ReleaseCut, now: number): ReleaseDue;
export function latestReleaseRef(refs: string[]): string | undefined;
export function reminderLine(result: ReleaseDue): string;
export function receiptNeeded(result: ReleaseDue, previous: string): { marker: string; needed: boolean };
export function reminderPlist(root: string, userHome: string): string;
export function main(args: string[]): ReleaseDue;
