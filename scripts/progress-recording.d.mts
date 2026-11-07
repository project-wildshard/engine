export interface ProgressClipCamera {
  readonly secs: number; readonly center: readonly [number, number, number]; readonly radius: number;
  readonly height: number; readonly startDeg: number; readonly sweepDeg: number; readonly fov?: number;
}
/** Capture the original orbit; caller revokes the returned URL after binary handoff, including failures. */
export function recordProgressClip(camera: ProgressClipCamera): Promise<{url: string; bytes: number}>;
