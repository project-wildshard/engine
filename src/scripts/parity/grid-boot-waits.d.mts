export interface GridBootWaitSample {
  label: string; at: number; frame: number | null; drawnFrame: number | null; ready: boolean | null;
  visibility: string | null; clockPaused: boolean | null; ringsReady: boolean | null;
  inFlight: number | null; queued: number | null; refused: number | null;
  cells: { instance: string | null; far: string | null }[];
  preparation: { instance: string | null; phase: string | null; ageMs: number | null; phaseAgeMs: number | null }[];
  waits: { count: number | null; oldest: { label: string | null; kind: string | null; ageMs: number | null }[] };
}
/** Bounded scalar history of the maintained smoke's existing polls; no additional polling or readiness policy. */
export function gridBootWaitHistory(): {
  samples: GridBootWaitSample[];
  observe: (label: string, at: number, observation: unknown) => void;
};
