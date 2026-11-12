/**
 * Which build the server has live (`/version.json`, no-store), for the build pill (src/client/engine/ui/Update.ts) and
 * Settings ▸ Build's Check (src/client/engine/ui/buildRow.ts). One read, one announcement: both controls answer the same
 * `ws-live-build` window event, so a Check in Settings lights the pill too, and a controlling service worker hears of the
 * build (`ws-sw-discovered`, src/client/engine/boot/sw.ts) and installs it, to be adopted at the next reload.
 */

declare const __BUILD_ID__: string;
/** vite.config.ts: package.json's version and its CHANGELOG.md section (scripts/changelog.mjs); absent under Node */
declare const __ENGINE_RELEASE__: EngineRelease;

/** `<sha>-<stamp>` → the 7-character commit, or the time token when the build had no git checkout. A world build's
 *  id is the full 40-character commit (Jake, 2026-11-10: "show the short commit, not this long ass thing"). */
export const shortBuild = (id: string): string => {
  const [gitSha = '', stamp = ''] = id.split('-');
  return /^[0-9a-f]{7,40}$/iu.test(gitSha) ? gitSha.slice(0, 7) : gitSha.length >= 7 ? gitSha : stamp;
};

/** The build this page runs. */
export const runningBuild = (): string => (typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '');

/** The engine version a build carries and that version's changelog (CHANGELOG.md, one to five plain-language bullets). */
export interface EngineRelease { readonly version: string; readonly date: string; readonly notes: readonly string[] }
/** This build's engine release; an empty one under a unit test. */
export const engineRelease = (): EngineRelease =>
  (typeof __ENGINE_RELEASE__ === 'object' ? __ENGINE_RELEASE__ : { version: '', date: '', notes: [] });

/** What the title's build pill and WHAT'S NEW box name a build by: "v0.1.5 · a8144a5" (either half alone when the
 *  other is unknown). */
export function buildLabel(id: string = runningBuild(), version: string = engineRelease().version): string {
  return [version === '' ? '' : `v${version}`, shortBuild(id)].filter(part => part !== '').join(' · ');
}

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

let asked = 0, announced = 0;
/** Read the live build and announce it, for the pill and Settings ▸ Build alike. One order across both: an answer that
 * lands after a later-asked one was announced is dropped, so a slow read never takes back a newer build. Resolves the
 * build read (announced or not), or null. */
export async function checkLiveBuild(): Promise<string | null> {
  const ticket = ++asked;
  const build = await liveBuild();
  if (build !== null && ticket > announced) { announced = ticket; applyLiveBuild(build); }
  return build;
}

/** The `ws-live-build` event's build, or null for anything else. */
export function liveBuildOf(event: Event): string | null {
  if (!(event instanceof CustomEvent)) return null;
  const value: unknown = event.detail;
  return typeof value === 'object' && value !== null && 'build' in value && typeof value.build === 'string' ? value.build : null;
}
