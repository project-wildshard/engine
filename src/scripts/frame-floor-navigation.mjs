import { gridFloorDocumentIdentity } from './frame-floor-grid.mjs';

/** Use the official network benchmark route, never a worker registration stub.
 * @param {string} base */
export function floorGridBenchmarkUrl(base) {
  return new URL('/?mute=1&nolock=1&sw=0', base).href;
}

/** Enter through the original HUD operation. A fading reveal can already be
 * behind live controls or detached; it is never a locator click target. */
export const FLOOR_GRID_ENTER = '(window.__wildshard.world.hud.enterNow(), true)';

/** @param {unknown} value */
function documentToken(value) {
  if (value === null || typeof value !== 'object' || !('token' in value)
    || typeof value.token !== 'string' || value.token.length === 0)
    throw new Error('Missing title-navigation document identity');
  return value.token;
}

/** Hand off the one intentional title navigation before any floor sample.
 * Submit the tap once through a synchronous protocol command. An asynchronous
 * result envelope cannot survive navigation. All later samples keep their fence.
 * @param {{ evaluate(expression:string):Promise<unknown>, tapGrid():Promise<unknown>, followed():Promise<unknown> }} driver */
export async function handoffFloorGridNavigation(driver) {
  const identity = `(${gridFloorDocumentIdentity.toString()})()`;
  const before = documentToken(await driver.evaluate(identity));
  await driver.tapGrid();
  await driver.followed();
  const after = documentToken(await driver.evaluate(identity));
  if (before === after)
    throw new Error('The grid tap did not hand off to a new document');
}

/** Submit the same title-button tap before its existing delayed navigation. */
export const FLOOR_GRID_TAP = `(() => {
  const button = document.querySelector('.ws-main-grid');
  if (!button) throw new Error('The title grid button disappeared before the tap');
  setTimeout(() => button.click(), 100);
  return true;
})()`;
