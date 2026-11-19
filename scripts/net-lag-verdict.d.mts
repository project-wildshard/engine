export interface BridgeSample {
  reached?: boolean;
  under?: number;
  falls?: number;
  corrections?: number;
  injectedSinks?: number[];
  forcedFrames?: number;
  forcedFrameMs?: number;
  spanSamples?: number;
  lowest?: number | null;
}
export interface ProofRow extends Record<string, unknown> {
  error?: unknown;
  errors?: readonly unknown[];
  b1?: { ok: boolean };
  b2?: { ok: boolean };
  b3?: { ok: boolean };
  b4?: BridgeSample & { ok: boolean };
}
export function bridgeVerdict(sample: BridgeSample): BridgeSample & { ok: boolean; replayExercised: boolean };
export function installBridgeCorrections(): void;
export function proofVerdict(row: ProofRow, mode: 'correctness' | 'timing'): ProofRow & {
  measurement: 'correctness' | 'timing';
  checked: string[];
  ok: boolean;
};
export function b3Verdict(delays: readonly { t: number; delay: number }[], heldFrom: number, heldAfter: number, forcedEndMs?: number): {
  delayMaxAfter10s: number | null;
  held: number;
  fromSeconds: number;
  ok: boolean;
};
