/** Reload only on explicit APPLY & RELOAD; currentPose also serves recovery. */
import { RELOAD_PARAM } from '../core/GpuRecovery';
import { settingsReloadUrl } from './Settings';
import { leaveSaved, markReload } from '../boot/lastEnd';
import { leftByPlayer } from '../boot/dropNotice';
import { showReloading } from './reloadCover';
import { leaveAfterPaint } from '../boot/leaveAfterPaint';
import { terrainDatum } from '../../../shared/engine/world/terrainHeight';
import { setTitleArrival } from '../boot/titleArrival';

interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }
let poseOf: () => Pose | null = () => null;
/** where the player stands now (null before ENTER WORLD): main.ts registers it next to installGpuRecovery */
export function setPoseProvider(fn: () => Pose | null): void { poseOf = fn; }
/** where the player stands now (null before ENTER WORLD, or if asking throws): the error modal's RELOAD HERE and error reports (E133) */
export function currentPose(): Pose | null { try { return poseOf(); } catch { return null; } }

/** params that skip the title (dev / deep links): the reload drops them; a reload from a world sets its own `at` again */
const TITLE_SKIPPERS = ['skipintro', 'tour', 'showcase', 'nolock', 'x', 'z', 'yaw', 'pitch', 'at', RELOAD_PARAM];

/** reload the page with the saved picks; `control` (the tapped button) turns into a loading button and the full-page
 *  RELOADING cover goes up in the tap's own turn (RL3). SR12: in a world it comes back in the same shard where the player
 *  stands: a shard page by `?at=` (the level's authored frame) and `?glreload`, as GPU recovery does; a grid page (no
 *  `?chunk=`) by the planned-reload capture markReload's `settings` reason runs, on its bare address; an online build also carries the tap that seated it (QA
 *  row 16), since a level there enters only from one. On the title (no pose) it is an explicit reload: back to the title. */
export function reloadWithPicks(why = 'reload prompt: reload now', control?: HTMLElement): void {
  showReloading(control);
  const url = new URL(settingsReloadUrl(location.href, TITLE_SKIPPERS));
  url.searchParams.delete('v');
  const pose = currentPose(), chunk = url.searchParams.get('chunk');
  // a grid page's address names no shard: its planned-reload record (markReload's capture) carries the cell and pose, and
  // a bare address lets it resume on an online build too (no `?at=` that would read as a level link)
  if (pose !== null && chunk !== null) {
    url.searchParams.set('at', [pose.x, pose.y - terrainDatum(), pose.z, pose.yaw, pose.pitch].map((v) => (Math.round(v * 100) / 100).toString()).join(','));
    url.searchParams.set(RELOAD_PARAM, '1');
  }
  const online = Reflect.get(globalThis, '__WS_WORLD__') !== undefined;
  leaveSaved(() => { leaveAfterPaint(() => {
    if (pose !== null && online && chunk !== null) setTitleArrival({ slug: chunk, mode: 'enter' }, { tab: true });
    leftByPlayer(); markReload(why, pose === null ? 'reload' : 'settings'); location.replace(url.toString());
  }); });
}
