/** Injected observation only; does not drive application progress or clocks. */
export function accuracyRecorder(): void;
export function accuracyCaption(text: string): void;
export interface AdmissionFrameRun {
  firstAt: number; lastAt: number; frames: number;
  step: string; footer: string; waiting: string; filesInFlight: string;
}
/** Bounded callback observations, not inferred paints or acceptance. */
export interface AdmissionFrames {
  protocol: 'loading-admission-raf/1'; frames: number; droppedFrames: number;
  truncatedFrames: number; maxGapMs: number; endedAt: number | null; runs: AdmissionFrameRun[];
}
