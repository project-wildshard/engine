/**
 * Which build the server has live (`/version.json`, no-store), for the build pill (src/client/engine/ui/Update.ts) and
 * Settings ▸ Build's Check (src/client/engine/ui/buildRow.ts). One read, one announcement: both controls answer the same
 * `ws-live-build` window event, so a Check in Settings lights the pill too, and a controlling service worker hears of the
 * build (`ws-sw-discovered`, src/client/engine/boot/sw.ts) and installs it, to be adopted at the next reload.
 */

declare const __BUILD_ID__: string;

/** `<sha>-<stamp>` → the sha, or the time token: Vercel CLI builds have no git checkout */
export const shortBuild = (id: string): string => { const [gitSha = '', stamp = ''] = id.split('-'); return gitSha.length >= 7 ? gitSha : stamp; };

/** The build this page runs. */
export const runningBuild = (): string => (typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '');

/** The live build's id, or null: offline (the PWA plays from its cache), a failed request, or an answer with no build. */
export async function liveBuild(): Promise<string | null> {
  if (!navigator.onLine) return null; // no request that can only fail
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j: unknown = await r.json();
    return typeof j === 'object' && j !== null && 'build' in j && typeof j.build === 'string' && j.build !== '' ? j.build : null;
  } catch { return null; }
}

/** Whether a service worker controls this page: then a new build reaches it only once that worker has installed it. */
export const workerControlled = (): boolean => (navigator.serviceWorker?.controller ?? null) !== null && window.__ws_sw?.enabled !== false;

/** Tell the page what is live: the pill, Settings ▸ Build and the worker each take it from here. */
export function applyLiveBuild(build: string): void {
  if (workerControlled()) window.dispatchEvent(new CustomEvent('ws-sw-discovered', { detail: { build } }));
  window.dispatchEvent(new CustomEvent('ws-live-build', { detail: { build } }));
}

/** The `ws-live-build` event's build, or null for anything else. */
export function liveBuildOf(event: Event): string | null {
  if (!(event instanceof CustomEvent)) return null;
  const value: unknown = event.detail;
  return typeof value === 'object' && value !== null && 'build' in value && typeof value.build === 'string' ? value.build : null;
}
