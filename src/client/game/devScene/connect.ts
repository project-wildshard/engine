import type * as THREE from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { DevSceneHost } from './host';
import { DEV_SCENE_PATH, DEV_SCENE_WIRE, decodeGeometry, type DevGeometry, type DevPart, type DevSceneState } from './wire';

/**
 * SHARD-SOURCE AP5: the page half of `wildshard watch`'s transport. Only a DEVSERVER page imports this, and it does nothing
 * unless its dev server answers `DEV_SCENE_PATH` (plain `wildshard dev` does not, so `dev` is unchanged). Each revision the
 * server announces, it fetches the parts whose hash changed (and only the geometry and rasters it lacks), then swaps them
 * in one call per part. `window.__wsDevScene` reports what landed and when it was first drawn, for AP6's timing script.
 */
export interface DevSceneReport {
  revision: number;
  /** the last revision whose parts were all swapped in, and the wall clock (ms) of the first frame drawn after it */
  framedRevision: number;
  framedAt: number;
  /** frames drawn since the host started: it only grows, swap or no swap */
  frames: number;
  error: string | null;
  applied: readonly string[];
  hashes: () => Record<string, string | undefined>;
  draws: () => Record<string, number>;
}

export async function connectDevScene(ports: { scope: Scope; scene: THREE.Object3D; physics: Physics | null; watchFrames: (fn: (dt: number) => void) => () => void }): Promise<DevSceneHost | null> {
  const probe = await fetch(`${DEV_SCENE_PATH}state`, { cache: 'no-store' }).catch(() => null);
  if (probe === null || !probe.ok || ports.scope.disposed) return null;
  const first = await probe.json() as DevSceneState;
  if (first.wire !== DEV_SCENE_WIRE) { console.error(`[devScene] the dev server speaks wire ${first.wire}, this page ${DEV_SCENE_WIRE}: update the SDK or the engine pin`); return null; }
  const { scope } = ports, host = new DevSceneHost(scope, ports.scene, ports.physics);
  const report: DevSceneReport = { revision: 0, framedRevision: 0, framedAt: 0, frames: 0, error: null, applied: host.applied,
    hashes: () => Object.fromEntries(host.names().map(name => [name, host.hash(name)])), draws: () => host.drawCounts() };
  scope.expose(window, '__wsDevScene', report);
  let pendingFrame: number | null = null;
  scope.onDispose(ports.watchFrames(() => {
    report.frames++;
    if (pendingFrame !== null) { report.framedRevision = pendingFrame; report.framedAt = Date.now(); pendingFrame = null; }
  }));

  const bytes = async (path: string): Promise<ArrayBuffer> => {
    const response = await fetch(`${DEV_SCENE_PATH}${path}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`dev scene: ${path} answered ${response.status}`);
    return response.arrayBuffer();
  };
  const sync = async (state: DevSceneState): Promise<void> => {
    report.error = state.error;
    if (state.error !== null) console.error(`[devScene] ${state.error}`);
    const changed = state.parts.filter(part => host.hash(part.name) !== part.hash);
    const parts = await Promise.all(changed.map(async ({ name }) => JSON.parse(new TextDecoder().decode(await bytes(`part/${encodeURIComponent(name)}`))) as DevPart));
    const geometries = new Map<string, DevGeometry>(), textures = new Map<string, Uint8Array>();
    await Promise.all(parts.flatMap(part => {
      const missing = host.missing(part);
      return [...missing.geometries.map(async key => { geometries.set(key, decodeGeometry(await bytes(`geometry/${key}`))); }),
        ...missing.textures.map(async texture => { textures.set(texture.key, new Uint8Array(await bytes(`texture/${texture.key}`))); })];
    }));
    if (scope.disposed) return;
    const assets = {
      geometry: (key: string): DevGeometry => { const geometry = geometries.get(key); if (geometry === undefined) throw new Error(`dev scene: geometry ${key} was not fetched`); return geometry; },
      texture: (key: string): Uint8Array => { const raster = textures.get(key); if (raster === undefined) throw new Error(`dev scene: texture ${key} was not fetched`); return raster; },
    };
    for (const part of parts) host.apply(part, assets);
    const live = new Set(state.parts.map(part => part.name));
    for (const name of host.names()) if (!live.has(name)) host.remove(name);
    report.revision = state.revision; pendingFrame = state.revision;
  };

  // One sync at a time; a revision announced while one runs is synced after it (only the newest one).
  let running: Promise<void> | null = null, next: DevSceneState | null = null;
  const enqueue = (state: DevSceneState): void => {
    next = state;
    if (running !== null) return;
    const drain = async (): Promise<void> => {
      while (next !== null && !scope.disposed) {
        const latest = next; next = null;
        try { await sync(latest); } catch (cause) { report.error = cause instanceof Error ? cause.message : String(cause); console.error('[devScene]', cause); }
      }
      running = null;
    };
    running = drain();
  };
  enqueue(first);
  const events = new EventSource(`${DEV_SCENE_PATH}events`);
  scope.listen(events, 'message', (event: Event) => { if (event instanceof MessageEvent && typeof event.data === 'string') enqueue(JSON.parse(event.data) as DevSceneState); });
  scope.onDispose(() => { events.close(); });
  return host;
}
