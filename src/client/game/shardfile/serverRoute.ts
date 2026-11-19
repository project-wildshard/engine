/** A world stamp always wins. A standalone worker requires a solo channel stamp. */
export type ServerRoute = 'online' | 'standalone' | 'missing';
export const MISSING_SERVER = 'No game server is configured. Run pnpm dev for the engine or wildshard dev for a shard.';

export function serverRoute(world: unknown, preview: unknown, explore?: unknown): ServerRoute {
  if (world !== undefined) return 'online';
  return preview === true || explore === true ? 'standalone' : 'missing';
}

export function pageServerRoute(): ServerRoute {
  const stamps = globalThis as { __WS_WORLD__?: unknown; __WS_PREVIEW__?: unknown; __WS_EXPLORE__?: unknown };
  return serverRoute(stamps.__WS_WORLD__, stamps.__WS_PREVIEW__, stamps.__WS_EXPLORE__);
}

/** Whether the door's `world` word (`socketFrames.ts` `WorldWord`, sent on every socket before hello) says it hosts the grid: more
 *  than the one home cell. */
export function hostsGrid(world: unknown): boolean {
  const cells = typeof world === 'object' && world !== null && 'cells' in world ? world.cells : null;
  return typeof cells === 'number' && cells > 1;
}

export function serverStepLabel(): string {
  const route = pageServerRoute();
  if (route === 'online') return 'Joining the world';
  return route === 'standalone' ? 'Starting the in-page server' : 'Game server';
}
