// Driftwood Isle (toon), shot data for any trailer. Ported from singleplayer scripts/steam-trailer/shots/driftwood.mjs
// (cf104912d3^): URL switches became setup poses (no URL switches, ever). Rig keys: t (s), p [x, dy, z] above ground or
// sea (rel), l [x, y, z] absolute look-at.
import { NO_VIEWMODEL, VIEWMODEL, CALM, WILD, held, at, aimAt, NEAR_KINDS, preyNear, tp, yawTo, js, PREY } from './lib.mjs';

const Z = 'driftwood-isle', T = 'golden', W = 'clear';
export const shots = [
  // open: over the sea, pushing in on the island, the gas giant high to the right
  { name: 'd-open', zone: Z, time: T, weather: W, secs: 5,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, ease: true, keys: [
      { t: 0, p: [-60, 34, -400], l: [30, 60, -60], fov: 52 },
      { t: 5, p: [-24, 16, -300], l: [20, 30, -80], fov: 56 },
    ] } },
  // the pier: a low tracking dolly along the planks, towards the island
  { name: 'd-pier', zone: Z, time: T, weather: W, secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, keys: [
      { t: 0, p: [2.2, 2.2, -246], l: [0, 3, -150], fov: 62 },
      { t: 4, p: [1.6, 2.4, -228], l: [0, 4, -120], fov: 62 },
    ] } },
  // the lookout: crane up from the headland to the whole island
  { name: 'd-lookout', zone: Z, time: T, weather: W, secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, ease: true, keys: [
      { t: 0, p: [102, 7, 113], l: [30, -2, -20], fov: 60 },
      { t: 4, p: [104, 18, 118], l: [0, -4, -120], fov: 60 },
    ] } },
  // play: walking the pier to the island on the game's own camera
  { name: 'd-walk', zone: Z, time: T, weather: W, secs: 4, warm: 90,
    setup: VIEWMODEL + CALM + tp(0, -205, Math.PI, -0.04),
    afterWarm: held('move.forward'),
    tick: (t) => `window.__wildshard.world.player.pitch = ${(-0.04 + Math.sin(t * 1.3) * 0.02).toFixed(4)};` },
  // fight: the sword's combo on a boar, the island behind it
  { name: 'd-combo', zone: Z, time: T, weather: W, secs: 4, warm: 120,
    setup: VIEWMODEL + WILD + tp(70, -150, yawTo(70, -150, 72, -140)),
    afterWarm: preyNear('/boar/', 4, -0.1),
    probe: NEAR_KINDS,
    tick: (t, i, sb, step) => js(aimAt(PREY, 0.25, 0.4),
      ([0.25, 0.65, 1.05].some((T2) => at(t, T2, step)) ? 'window.__wildshard.world.weapons.tryFire();' : ''),
      (at(t, 1.4, step) ? held('heavy') : ''),
      (at(t, 2.1, step) ? held('heavy', false) : '')) },
];

// the end: on the grid (Driftwood home, render = world), the camera rises off the player on the pier and pulls back until
// the whole grid is in view: the main menu's 5 × 5 overview A (heading 70°, 1350 m up, 2600 m out, aimed at Driftwood;
// scripts/main-menu-aerial-poses.ts grid5x5HeroPlan); the shipped 6 km far plane holds it
shots.push({ name: 'g-rise', zone: Z, grid: true, time: T, weather: W, secs: 7, warm: 300,
  setup: NO_VIEWMODEL + CALM + tp(0, -200, Math.PI, -0.04),
  afterWarm: `{ const p = window.__wildshard.world.player.position; const a = 70 * Math.PI / 180;
    window.__tr.setRig({ ease: true, keys: [
      { t: 0, p: [p.x + 1.5, p.y + 2.2, p.z - 4], l: [p.x, p.y + 1.6, p.z + 30], fov: 55 },
      { t: 2.2, p: [p.x + 40, p.y + 60, p.z - 60], l: [p.x * 0.6, 0, p.z * 0.6 + 40], fov: 55 },
      { t: 7, p: [1900 * Math.sin(a), 1050, 1900 * Math.cos(a)], l: [0, 0, 0], fov: 50 } ] }); }` });

// the open plots (AT4): the grid's south row (z = -2 × 562.5) is five plots waiting for their builders; a high slide along
// it from the south-west, Sky Reach and Brasscap beyond
shots.push({ name: 'g-plots', zone: Z, grid: true, time: T, weather: W, secs: 4, warm: 300,
  setup: NO_VIEWMODEL + CALM,
  rig: { ease: true, keys: [
    { t: 0, p: [-1250, 170, -1480], l: [-700, 0, -1000], fov: 52 },
    { t: 4, p: [-650, 190, -1500], l: [-100, 0, -1000], fov: 52 },
  ] } });

// the party (AT6): three other players, real clients of the same build in a local world (party.mjs --zone driftwood-isle
// --at 0,-138), wander the beach head; the camera walks up the pier to them. Captured with --wall against that world:
// remote bodies move on the page's real clock, so the shot runs in real time
shots.push({ name: 'd-party', zone: Z, time: T, weather: W, secs: 4, warm: 90,
  setup: VIEWMODEL + CALM + tp(0, -160, Math.PI, -0.05),
  afterWarm: held('move.forward') });
