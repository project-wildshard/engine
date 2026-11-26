// Sky Reach (`far-reach`, islands over a cloud sea), shot data for any trailer. Ported from singleplayer
// scripts/steam-trailer/shots/sky-reach.mjs (cf104912d3^). Every key is absolute: the heightfield under an islet is the
// sea far below. Sunrest (0, 0) deck 30, the windmill isle (0, -64) across the rope bridge, the high step with the winch
// (-64, -126) +44, the storm crown (0, -190) +44. The low sun stands west-north-west.
import { NO_VIEWMODEL, VIEWMODEL, CALM, WILD, held, at, aimAt, NEAR_KINDS, preyNear, js, PREY } from './lib.mjs';

const Z = 'far-reach', T = 'golden', W = 'clear';
export const shots = [
  // up out of the cloud sea beside Sunrest's keel, over its rim to the archipelago
  { name: 'sr-rise', zone: Z, time: T, weather: W, secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { ease: true, keys: [
      { t: 0, p: [14, 18, 34], l: [-2, 30, -60], fov: 52 },
      { t: 4, p: [6, 46, 40], l: [-4, 26, -70], fov: 54 },
    ] } },
  // play: down the rope bridge to the windmill isle on the game's own camera
  { name: 'sr-bridge', zone: Z, time: T, weather: W, secs: 4, warm: 90,
    setup: js(VIEWMODEL, CALM, 'await window.__wildshard.pose({ x: 0, y: 30, z: -8, yaw: 0, pitch: -0.03 });'),
    afterWarm: held('move.forward') },
  // the whole archipelago from high up, a slow slide
  { name: 'sr-aerial', zone: Z, time: T, weather: W, secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { ease: true, keys: [
      { t: 0, p: [-30, 90, 70], l: [-10, 30, -90], fov: 55 },
      { t: 4, p: [20, 92, 72], l: [6, 30, -90], fov: 55 },
    ] } },
  // fight: the fan on a sky goat
  { name: 'sr-goat', zone: Z, time: T, weather: W, secs: 4, warm: 120,
    setup: VIEWMODEL + WILD,
    afterWarm: preyNear('/skyGoat|galeWisp/', 6),
    probe: NEAR_KINDS,
    tick: (t, i, sb, step) => js(aimAt(PREY, 0.2, 0.6),
      ([0.3, 1.2, 2.2].some((T2) => at(t, T2, step)) ? 'window.__wildshard.world.weapons.tryFire();' : '')) },
];
