import { routeFor } from '../memory/iphone/route.mjs';

/** @typedef {Omit<Parameters<typeof import('./measure.mjs').measureFps>[0], 'cpu' | 'floor'> & {factor:string|null}} ProfileSpec */
const PHONE = /** @type {const} */ ({ browser: 'chromium', tier: 'phone', width: 402, height: 812, dpr: 3 });
const DESKTOP = /** @type {const} */ ({ browser: 'chromium', tier: 'desktop', cap: null });
const displays = /** @type {const} */ ([{ width: 1496, height: 717, dpr: 2 }, { width: 1920, height: 1080, dpr: 1 }]);
/** @param {(typeof displays)[number]} display @param {'low'|'medium'|'high'} graphics @param {string|null} factor
 * @returns {ProfileSpec} */
function desktop(display, graphics, factor) {
  return { ...DESKTOP, ...display, graphics, factor, tier: graphics === 'low' ? 'phone' : 'desktop' };
}
/** @type {Record<string, ProfileSpec[]>} */
const fullProfiles = {
  'phone-lpm-low': [{ ...PHONE, graphics: 'low', cap: 30, factor: 'phoneLpm' }],
  'phone-high': [{ ...PHONE, graphics: 'high', cap: 60, factor: 'phoneNormal' }],
  'phone-low': [{ ...PHONE, graphics: 'low', cap: 60, factor: 'phoneNormal' }],
  // J495 (Jake, 2026-11-23): desktop Low and High keep their looks; Medium (engine core/desktopPreset.ts) is the preset a
  // half-speed desktop CPU plays at 120. desktop-native holds Low and High to the floor on a full-speed CPU.
  'desktop-medium': displays.map(display => desktop(display, 'medium', 'desktopTypical')),
  'desktop-native': displays.flatMap(display => [desktop(display, 'high', null), desktop(display, 'low', null)]),
};

/** Quick routes share one cold boot per profile. Qualification keeps every original window.
 * @param {{qualify?:boolean,runs?:string,dockOnly?:boolean,coldOnly?:boolean,windows?:string}} [options] */
export function fpsPlan({ qualify = false, runs, dockOnly = false, coldOnly = false, windows } = {}) {
  const count = Number(runs ?? (qualify ? 3 : 1));
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Use a positive run count');
  if (qualify && (count !== 3 || dockOnly || coldOnly))
    throw new Error('--qualify requires three cold runs, every route window and the final warm repeat');
  const windowCount = windows === undefined ? 5 : Number(windows);
  if (windows !== undefined && (!qualify || !Number.isSafeInteger(windowCount) || windowCount < 1 || windowCount > 5))
    throw new Error('--windows requires --qualify and a count from 1 to 5');
  const fullRoute = routeFor('driftwood-fps');
  /** @type {import('../memory/iphone/route.mjs').RouteLeg[]} */
  const route = [];
  for (const [index,leg] of fullRoute.entries()) {
    if (index >= (qualify ? windowCount : dockOnly ? 1 : 3)) break;
    // Keep the full dock rotation and village dwell. Fit all five cold
    // profiles in one bounded lease, with every waypoint still required.
    route.push(qualify ? leg : {...leg,seconds:[30,25,40][index]});
  }
  const profiles = Object.fromEntries(Object.entries(fullProfiles).map(([name, specs]) =>
    [name, qualify ? specs : specs.slice(0, 1)]));
  return { mode: qualify ? 'qualify' : 'quick', scope: qualify ? windowCount === 5 ? 'route' : 'subset' : dockOnly ? 'dock' : 'quick',
    profiles, route, count, warm: qualify, limitMs: qualify ? null : 20 * 60 * 1000 };
}
