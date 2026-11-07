/** Reload only on explicit APPLY & RELOAD; currentPose also serves recovery. */
import { RELOAD_PARAM } from '../core/GpuRecovery';
import { settingsReloadUrl } from './Settings';
import { leaveSaved, markReload } from '../boot/lastEnd';

interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }
let poseOf: () => Pose | null = () => null;
/** where the player stands now (null before ENTER WORLD): main.ts registers it next to installGpuRecovery */
export function setPoseProvider(fn: () => Pose | null): void { poseOf = fn; }
/** where the player stands now (null before ENTER WORLD, or if asking throws): the error modal's RELOAD HERE and error reports (E133) */
export function currentPose(): Pose | null { try { return poseOf(); } catch { return null; } }

/** params that skip the title (dev / deep links): the reload drops them so it lands on the title */
const TITLE_SKIPPERS = ['skipintro', 'tour', 'showcase', 'nolock', 'x', 'z', 'yaw', 'pitch', 'at', RELOAD_PARAM];

/** reload the page with the saved picks, on the title */
export function reloadWithPicks(why = 'reload prompt: reload now'): void {
  const url = new URL(settingsReloadUrl(location.href, TITLE_SKIPPERS));
  url.searchParams.delete('v');
  leaveSaved(() => { markReload(why); location.replace(url.toString()); });
}
