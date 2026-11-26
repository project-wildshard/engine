/** One smoke receipt: a profile's stable leaf durations (ms) at a time. */
export interface SmokeReceipt {
  readonly at: string;
  readonly profile: string;
  readonly split: Readonly<Record<string, number>>;
}
/** One leaf against the preceding week's median of the same profile. */
export interface SmokeVerdict {
  readonly name: string;
  readonly ms: number;
  readonly medianMs: number | null;
  readonly samples: number;
  readonly flagged: boolean;
}
/** The receipts in a lane log (`TEMPLATE_SMOKE {json}` lines); torn lines are skipped. */
export function readSmokeHistory(text: string): SmokeReceipt[];
/** Each leaf of `current` against the preceding week of `history` (3 or more samples; 30 % growth is flagged). */
export function smokeSplitRegression(current: SmokeReceipt, history: readonly SmokeReceipt[]): SmokeVerdict[];
