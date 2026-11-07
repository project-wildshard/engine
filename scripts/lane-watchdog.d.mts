/** Latest lane-specific report resolving to a unique commit in newest-first git history. */
export function latestLaneCommit(history: string, text: string, name: string,
  pane: string, ledger: ReadonlyMap<string, string>, previous?: string, coordinatorText?: string):
  { sha: string; at: number } | undefined;
/** Observed own/coordinator reports and new-turn prompts, deduplicated by the observer. */
export function laneTurnMarkers(history: string, text: string, name: string, coordinatorText?: string): string[];
/** A turn clock and its already consumed boundary reports. */
export interface TurnObservation { since: number; alerted: boolean; seen: ReadonlySet<string> }
/** Reset for a new report only; unchanged visible text keeps the existing clock. */
export function observeLaneTurn(turn: TurnObservation, markers: readonly string[], now: number): TurnObservation;
export function releaseCheckDue(now: number, last: number): boolean;
