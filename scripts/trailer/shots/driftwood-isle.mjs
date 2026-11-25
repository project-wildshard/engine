// Driftwood Isle (toon), shot data for any trailer. Ported from singleplayer scripts/steam-trailer/shots/driftwood.mjs
// (cf104912d3^): URL switches became setup poses (no URL switches, ever). Rig keys: t (s), p [x, dy, z] above ground or
// sea (rel), l [x, y, z] absolute look-at.
import { NO_VIEWMODEL, VIEWMODEL, CALM, WILD, held, at, aimAt, NEAR_KINDS, tp, yawTo, js } from './lib.mjs';

const Z = 'driftwood-isle', T = 'golden', W = 'clear';
const preyNear = (kind, back = 2.6) => `{ const w = window.__wildshard.world; const b = w.animals.animals.filter((a) => a.kind === '${kind}' && a.alive).sort((a, c) => a.position.distanceTo(w.player.position) - c.position.distanceTo(w.player.position))[0];
  if (b) { window.__prey = b; const l = Math.hypot(b.position.x, b.position.z) || 1, px = b.position.x + b.position.x / l * ${back}, pz = b.position.z + b.position.z / l * ${back};
  await window.__wildshard.pose({ x: px, z: pz, yaw: Math.atan2(-(b.position.x - px), -(b.position.z - pz)), pitch: -0.12 }); } }`;
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
    afterWarm: preyNear('boar'),
    probe: NEAR_KINDS,
    tick: (t, i, sb, step) => js(aimAt('window.__prey', 0.25, 0.4),
      ([0.25, 0.65, 1.05].some((T2) => at(t, T2, step)) ? 'window.__wildshard.world.weapons.tryFire();' : ''),
      (at(t, 1.4, step) ? held('heavy') : ''),
      (at(t, 2.1, step) ? held('heavy', false) : '')) },
];
