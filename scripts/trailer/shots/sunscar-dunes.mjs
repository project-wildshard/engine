// Signal Dunes (`sunscar-dunes`, dusk), shot data for any trailer. Ported from singleplayer
// scripts/steam-trailer/shots/dunes.mjs (cf104912d3^). Coordinates are the zone's layout: the spawn crest faces -z over the
// dune rows to the signal tower (8, -75), the caravan (-78, 28), the east waymark (58, -34). Rig keys: p [x, dy, z]
// above the sand (rel), l absolute. `window.__wildshard.shard.sunscar.stage(name)` runs one of the zone's captures.
import { NO_VIEWMODEL, VIEWMODEL, CALM, WILD, at, aimAt, NEAR_KINDS, preyNear, js, PREY } from './lib.mjs';

const Z = 'sunscar-dunes', T = 'sunset', W = 'clear';
const LIT = "window.__wildshard.shard.sunscar?.stage?.('waymarks-lit');";
export const shots = [
  // off the spawn crest, a rising push over the dune rows to the tower
  { name: 'dn-vista', zone: Z, time: T, weather: W, secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, ease: true, keys: [
      { t: 0, p: [-4, 1.4, 82], l: [6, 24, -75], fov: 48 },
      { t: 4, p: [1, 4.5, 64], l: [8, 26, -75], fov: 46 },
    ] } },
  // the caravan in the dunes
  { name: 'dn-caravan', zone: Z, time: T, weather: W, secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, ease: true, keys: [
      { t: 0, p: [-60, 1.7, 43], l: [-78, 16.5, 28], fov: 50 },
      { t: 4, p: [-68, 1.4, 36], l: [-78, 17, 28], fov: 46 },
    ] } },
  // fight: the whip on a dune strider
  { name: 'dn-whip', zone: Z, time: T, weather: W, secs: 4, warm: 120,
    setup: VIEWMODEL + WILD,
    afterWarm: preyNear('/duneStrider|sandSkitterer/', 5.5),
    probe: NEAR_KINDS,
    tick: (t, i, sb, step) => js(aimAt(PREY, 0.2, 1.2),
      ([0.3, 1.1, 2.1].some((T2) => at(t, T2, step)) ? 'window.__wildshard.world.weapons.tryFire();' : '')) },
  // the signal lit: a crane up past the east waymark's fire to the burning tower, deep dusk
  { name: 'dn-signal', zone: Z, time: 'night', weather: W, secs: 4,
    setup: NO_VIEWMODEL + CALM + LIT,
    rig: { rel: true, ease: true, keys: [
      { t: 0, p: [66, 1.2, -24], l: [50, 25, -45], fov: 52 },
      { t: 4, p: [68, 6, -20], l: [10, 26, -75], fov: 50 },
    ] } },
];
