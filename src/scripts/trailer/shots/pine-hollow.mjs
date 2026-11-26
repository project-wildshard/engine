// Pine Hollow (photoreal pines), shot data for any trailer. Ported from singleplayer
// scripts/steam-trailer/shots/pine.mjs (cf104912d3^); the URL harness (elite=, boss=, tod=) is gone, so the time and the
// weather are Debug settings and the fight takes the boars and elk the zone spawns. Rig keys: p and l [x, dy, z] above
// the ground (rel + relLook).
import { NO_VIEWMODEL, VIEWMODEL, CALM, WILD, held, at, aimAt, NEAR_KINDS, preyNear, js, lerp, ease, PREY } from './lib.mjs';

const Z = 'pine-hollow';
export const shots = [
  // the standing stones: a slow drift round them, low sun through the trunks
  { name: 'p-stones', zone: Z, time: 'golden', weather: 'clear', secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, relLook: true, ease: true, keys: [
      { t: 0, p: [124, 1.6, -20], l: [178, 7, -34], fov: 52 },
      { t: 4, p: [131, 2.0, -23], l: [178, 7, -34], fov: 50 },
    ] } },
  // the valley from the ridge: a crane up over the treetops
  { name: 'p-final', zone: Z, time: 'golden', weather: 'clear', secs: 5,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, relLook: true, ease: true, keys: [
      { t: 0, p: [24, 5, 196], l: [-10, 8, 60], fov: 55 },
      { t: 5, p: [27, 11, 204], l: [-14, 6, 56], fov: 57 },
    ] } },
  // the pond at sunset
  { name: 'p-pond', zone: Z, time: 'sunset', weather: 'clear', secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, relLook: true, keys: [
      { t: 0, p: [-56, 1.7, 92], l: [-88, 12, 152], fov: 52 },
      { t: 4, p: [-64, 1.5, 100], l: [-88, 12, 152], fov: 52 },
    ] } },
  // play: a jog through the pines on the game's own camera
  { name: 'p-run', zone: Z, time: 'golden', weather: 'clear', secs: 4, warm: 90,
    setup: VIEWMODEL + CALM,
    afterWarm: held('move.forward') + held('sprint'),
    tick: (t) => `window.__wildshard.world.player.pitch = ${lerp(0, -0.05, ease(t / 4)).toFixed(4)};` },
  // fight: the crossbow on a charging boar
  { name: 'p-boar', zone: Z, time: 'golden', weather: 'clear', secs: 4, warm: 120,
    setup: VIEWMODEL + WILD,
    afterWarm: preyNear('/boar|elk/', 9),
    probe: NEAR_KINDS,
    tick: (t, i, sb, step) => js(aimAt(PREY, 0.2, 0.5),
      ([0.4, 1.6, 2.8].some((T) => at(t, T, step)) ? 'window.__wildshard.world.weapons.tryFire();' : '')) },
];
