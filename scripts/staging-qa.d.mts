import type { Finding, Severity } from './staging-smoke/checks.mjs';

interface SmokeEvidence {
  build?: string;
  findings: readonly Finding[];
  scenarios: readonly { id: string; status: string; legs: readonly { playedMs?: number }[] }[];
}

interface Proof {
  id: string;
  browser: string;
  pass: boolean;
  seconds: number;
  playedMs: number;
  reason?: string;
  log: string;
}

export function mergeVerdict(input: {
  build: string;
  smoke: SmokeEvidence;
  proofs: Proof[];
  expected: readonly string[];
  selected: readonly string[];
  after?: string;
  full: boolean;
  runner?: readonly Finding[];
}): { findings: Finding[]; worst: Severity | 'none'; hold: boolean; minutesInPlay: number; full: boolean };

export function holdLine(verdict: { release: string; findings: readonly Finding[] }, owner: string): string | undefined;

/** Build-max C4: the journey leg's card, a shard the local rig hosts. */
export const JOURNEY_CARD: string;
/** Build-max C4: the zone gate leg's target for a base URL; staging crosses into Nalati and walks back in. */
export function gateLeg(url: string): { target: string; reenter: boolean };
