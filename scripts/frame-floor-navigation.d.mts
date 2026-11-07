/** One explicit title-document handoff before measurement; never replays a tap. */
export function handoffFloorGridNavigation(driver: {
  evaluate: (expression: string) => Promise<unknown>;
  tapGrid: () => Promise<unknown>;
  followed: () => Promise<unknown>;
}): Promise<void>;
/** The existing grid-button tap submitted as a synchronous protocol command. */
export const FLOOR_GRID_TAP: string;
/** The official muted benchmark URL, with service workers disabled. */
export function floorGridBenchmarkUrl(base: string): string;
/** Original idempotent HUD entry; no reveal locator or pointer interaction. */
export const FLOOR_GRID_ENTER: string;
