import type { FloorGridState } from './frame-floor-grid.mjs';

export interface DomeView {
  readonly n: number; readonly name: string;
  readonly eye: readonly [number, number, number]; readonly look: readonly [number, number, number];
  readonly yaw: number; readonly pitch: number; readonly hfov: number;
}
export interface DomeCameras {
  readonly dome: string; readonly type: 'stand' | 'look'; readonly pair: string;
  readonly mockup: string; readonly layout: string; readonly convention: string;
  readonly anchor: readonly [number, number, number]; readonly views: readonly DomeView[];
}
export interface DomeGroundAnchor { readonly x: number; readonly z: number; readonly instance: string | null }
export function parseDomeCameras(value: unknown): DomeCameras;
export function domeWorldCamera(camera: DomeView, origin: { x: number; z: number }, aspect: number): {
  eye: [number, number, number]; look: [number, number, number]; fov: number;
};
export function domeGroundAnchor(cameras: DomeCameras, grid: Pick<FloorGridState, 'pitch' | 'cells'>, instance: string): DomeGroundAnchor;
export function assertDomeAnchorReady(grid: Pick<FloorGridState, 'inside' | 'live'>, anchor: DomeGroundAnchor): void;
export interface DomeResidencyState {
  readonly live: {
    readonly live: {readonly gameplayReady: boolean; readonly pending: readonly string[]};
    readonly crossing: {readonly phase: string; readonly issue: string | null};
  };
  readonly rings: {readonly inFlight: number; readonly queued: number};
}
export function domeResidencySettled(grid: DomeResidencyState): boolean;
