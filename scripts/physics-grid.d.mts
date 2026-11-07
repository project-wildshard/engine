export interface GridReadout { pitch?: number; home: string; cells: readonly { instance: string; slug: string; cell: readonly [number, number] }[] }
export interface GridSeamRoute { home: string; peer: string; speed: 15 | 30; start: { x: number; z: number }; waypoints: { x: number; z: number }[]; timeout: number; turnaround: number }
export interface GridDriveResult extends GridSeamRoute {
  trace: { time: number; x: number; y: number; z: number; current: string | null; enabled: boolean; gameplayReady: boolean }[];
  stuck: { waypoint: number; x: number; y: number; z: number; current: string | null }[];
  complete: boolean; timedOut: boolean; crossingDelta: number; transitions: { from: string | null; to: string | null }[]; issues: Record<string, string>; backgroundIssues?: Record<string, string>;
}
export function gridSeamRoute(state: GridReadout, speed: 15 | 30): GridSeamRoute;
export function driveGridSeam(route: GridSeamRoute): Promise<GridDriveResult>;
export function gridDriveFailures(result: GridDriveResult): string[];
