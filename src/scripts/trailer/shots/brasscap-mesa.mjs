// Brasscap Mesa (sunset canyon town), shot data for any trailer. New for alpha 2 (meta ALPHA-2-TRAILER AT4): built in its
// own repo (shard-brasscap) with Claude Code. The player spawns on the saloon porch (-1.6, 0) facing down the main street
// (-z); bandit camps line the street (z -24 … -68) and the Dust Wyrm surfaces in its arena at (2, -100).
import { NO_VIEWMODEL, VIEWMODEL, CALM, WILD, held, at, aimAt, NEAR_KINDS, preyNear, js, PREY } from './lib.mjs';

const Z = 'brasscap-mesa', T = 'golden', W = 'clear';
/** in-page: a rig orbiting the player's spawn, `R` m out and `H` m up, from angle a0 to a1 (radians off its facing) */
const orbit = (R, H, a0, a1, fov) => `{ const w = window.__wildshard.world, p = w.player.position.clone(), f = w.player.yaw;
  const o = (a) => [p.x - Math.sin(f + a) * ${R}, p.y + ${H}, p.z - Math.cos(f + a) * ${R}];
  window.__tr.setRig({ ease: true, keys: [{ t: 0, p: o(${a0}), l: [p.x, p.y + 2, p.z], fov: ${fov} }, { t: 4, p: o(${a1}), l: [p.x, p.y + 2, p.z], fov: ${fov} }] }); }`;
export const shots = [
  // play: off the saloon porch and down the main street, the lever rifle in hand
  { name: 'b-street', zone: Z, time: T, weather: W, secs: 3.5, warm: 60, setup: VIEWMODEL + CALM, afterWarm: held('move.forward') },
  // the town: a low crane round the station and the BRASSCAP sign
  { name: 'b-town', zone: Z, time: T, weather: W, secs: 4, setup: NO_VIEWMODEL + CALM, afterWarm: orbit(25, 5, Math.PI + 0.6, Math.PI - 0.2, 60) },
  // fight: the lever rifle on a bandit camp. Brasscap is no cell of the staging grid (11-25): players reach it from ZONE
  // SELECT, alone, so this shot boots it alone as they see it
  { name: 'b-bandits', zone: Z, singleZone: true, time: T, weather: W, secs: 4, warm: 120,
    setup: VIEWMODEL + WILD,
    afterWarm: preyNear('/bandit/', 6.5),
    probe: NEAR_KINDS,
    tick: (t, i, sb, step) => js(aimAt(PREY, 0.2, 0.9),
      ([0.35, 1.2, 2.05, 2.9].some((T2) => at(t, T2, step)) ? 'window.__wildshard.world.weapons.tryFire();' : '')) },
  // fight: the Dust Wyrm breaks out of its arena; the rifle answers
  { name: 'b-wyrm', zone: Z, time: T, weather: W, secs: 5, warm: 180,
    setup: VIEWMODEL + WILD,
    afterWarm: preyNear('/^wyrm$/', 16, 0.08),
    probe: NEAR_KINDS,
    tick: (t, i, sb, step) => js(aimAt(PREY, 0.15, 3),
      ([0.6, 1.5, 2.4, 3.3, 4.2].some((T2) => at(t, T2, step)) ? 'window.__wildshard.world.weapons.tryFire();' : '')) },
];
