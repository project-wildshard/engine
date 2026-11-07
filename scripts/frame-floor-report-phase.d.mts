export interface FloorCpuFence { frame: number; atMs: number; firstCompletedFrame: number; documentOrigin: number }
export interface FloorCpuPhaseReading { bootRate: number; requestedRate: number; measuredRate: number | null; fence: FloorCpuFence | null }
/** Require throttle acknowledgement and two new completed draws before measuring report-only rows. */
export function frameFloorCpuPhase(rate: number, postReady: boolean, ports: {
  apply: (rate: number) => Promise<unknown>; fence: () => Promise<FloorCpuFence>;
}): { boot: () => Promise<void>; measure: () => Promise<void>; reading: () => FloorCpuPhaseReading };
/** Only explicitly declared Linux report-only SwiftShader may substitute for Metal. */
export function assertFrameFloorRenderer(renderer: string, policy: {
  angle: string; explicit: boolean; reportOnly: boolean; platform: string;
}): void;
