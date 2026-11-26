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
// src/scripts/main-menu-aerial-poses.ts grid5x5HeroPlan); the shipped 6 km far plane holds it
shots.push({ name: 'g-rise', zone: Z, time: T, weather: W, secs: 7, warm: 300,
  setup: NO_VIEWMODEL + CALM + tp(0, -200, Math.PI, -0.04),
  afterWarm: `{ const p = window.__wildshard.world.player.position; const a = 70 * Math.PI / 180;
    window.__tr.setRig({ ease: true, keys: [
      { t: 0, p: [p.x + 1.5, p.y + 2.2, p.z - 4], l: [p.x, p.y + 1.6, p.z + 30], fov: 55 },
      { t: 2.2, p: [p.x + 40, p.y + 60, p.z - 60], l: [p.x * 0.6, 0, p.z * 0.6 + 40], fov: 55 },
      { t: 7, p: [1900 * Math.sin(a), 1050, 1900 * Math.cos(a)], l: [0, 0, 0], fov: 50 } ] }); }` });

// the open plots (AT4): the grid's south row (z = -2 × 562.5) is five plots waiting for their builders; a high slide along
// it from the south-west, Sky Reach and Brasscap beyond
shots.push({ name: 'g-plots', zone: Z, time: T, weather: W, secs: 4, warm: 300,
  setup: NO_VIEWMODEL + CALM,
  rig: { ease: true, keys: [
    { t: 0, p: [-1250, 170, -1480], l: [-700, 0, -1000], fov: 52 },
    { t: 4, p: [-650, 190, -1500], l: [-100, 0, -1000], fov: 52 },
  ] } });

// the party (AT6): three other players, real clients of the same build in a local world, walk off the pier together and
// the camera walks backwards in front of them, framing all three. The party runs first with a cue port (party.mjs
// --zone driftwood-isle --at 0,-200 --go 4498 --spread 1); the shot's afterWarm cues the march from PARTY, and every tick the lens
// follows the bodies the page draws (`__onlinePlayers`), so their real pace never matters. Captured with --wall
// against that world (remote bodies move on the page's real clock).
export const PARTY = { x: 0, z: -200, yaw: Math.PI, go: 4498 };
/** in-page: cue the party's march (party.mjs --go), then give the poses a moment to reach this page */
export const cueParty = (from = PARTY, speed = 0.4, wait = 300) => `await fetch('http://127.0.0.1:${from.go}/go?x=${from.x}&z=${from.z}&yaw=${from.yaw}&speed=${speed}', { mode: 'no-cors' }).catch(() => {});
  await new Promise((r) => { setTimeout(r, ${wait}); });`;
/** in-page, per tick: the lens `r` m from the party's middle, `h` m up, at angle a (radians off the way they walk, 0 = dead
 * ahead looking back at them) easing from a0 to a1 over `secs`, smoothed so a body's step never jolts it */
export const followParty = (t, secs, { r = 6.5, h = 1.7, a0 = 0.5, a1 = -0.2, fov = 50, lead = 1 } = {}) => {
  const k = Math.min(1, Math.max(0, t / secs)), u = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2, a = a0 + (a1 - a0) * u;
  // only the bodies near the party's last known middle (a world keeps a closed page's body a while: never frame a ghost)
  return `{ const m0 = window.__pm ?? { x: ${PARTY.x}, z: ${PARTY.z} }; const o = (window.__onlinePlayers?.() ?? []).filter((b) => b.modelled && Math.hypot(b.x - m0.x, b.z - m0.z) < 9); if (o.length > 0) {
    const n = o.length, c = o.reduce((m, b) => ({ x: m.x + b.x / n, y: m.y + b.y / n, z: m.z + b.z / n }), { x: 0, y: 0, z: 0 }); window.__pm = c;
    const f = ${PARTY.yaw}, fx = -Math.sin(f), fz = -Math.cos(f), a = ${a.toFixed(5)};
    const dx = fx * Math.cos(a) - fz * Math.sin(a), dz = fz * Math.cos(a) + fx * Math.sin(a);
    const want = [c.x + dx * ${r}, c.y + ${h}, c.z + dz * ${r}, c.x + fx * ${lead}, c.y + 1.15, c.z + fz * ${lead}];
    const s = window.__pc ?? (window.__pc = want.slice()); for (let i = 0; i < 6; i++) s[i] += (want[i] - s[i]) * 0.12;
    window.__tr.setRig({ handheld: 0.4, keys: [{ t: 0, p: s.slice(0, 3), l: s.slice(3), fov: ${fov} }, { t: 1e6, p: s.slice(0, 3), l: s.slice(3), fov: ${fov} }] }); } }`;
};
// --wall at 1080p draws about 20 frames a real second, so the party (moving on the server's real time) plays about 3x fast:
// a 0.27 walk cue reads as the first cut's stroll (AT15, 11-25; a 60 fps real-time capture would need a screencast path)
shots.push({ name: 'd-party', zone: Z, time: T, weather: W, secs: 5, warm: 120,
  setup: NO_VIEWMODEL + CALM + tp(60, 40, Math.PI, 0) + cueParty(PARTY, 0.27),
  tick: (t) => followParty(t, 5, { a0: 0.5, a1: -0.3, r: 7, h: 1.9 }),
  probe: '(() => ({ framed: window.__pm, bodies: (window.__onlinePlayers?.() ?? []).map((b) => [b.name, +b.x.toFixed(1), +b.z.toFixed(1), b.gait]) }))()' });

// the end, held low (Jake, 11-24: far views wait): from behind the party walking off the pier, the camera rises and pulls
// back south over the sea until the whole island fills the frame, tilted down so the horizon (the unfinished far cells)
// stays out of it. The party is cued at the pier's end; the first 1.2 s holds while their bodies settle (the cut starts
// after it). Scouted against g-rise's 1050 m pull-back, which showed far cells unfinished.
shots.push({ name: 'g-rise-low', zone: Z, time: T, weather: W, secs: 9.6, warm: 300,
  setup: NO_VIEWMODEL + CALM + tp(60, 40, Math.PI, 0),
  afterWarm: cueParty({ ...PARTY, z: -206 }, 0.4),
  rig: { ease: false, keys: [
    { t: 0, p: [2.2, 3.6, -216], l: [0, 2.4, -192], fov: 52 },
    { t: 1.2, p: [2.2, 3.6, -216], l: [0, 2.4, -192], fov: 52 },
    // on the grid (AT15) it tops out about 32 m up: higher, the neighbours show their cut edges and the far grid's cyan
    { t: 4.5, p: [7, 22, -248], l: [0, 1, -140], fov: 53 },
    { t: 7.5, p: [8, 30, -258], l: [0, 0, -132], fov: 52 },
    { t: 9.6, p: [8, 32, -262], l: [0, 0, -130], fov: 52 },
  ] },
  probe: '(() => ({ party: (window.__onlinePlayers?.() ?? []).map((b) => [b.name, +b.x.toFixed(1), +b.z.toFixed(1)]) }))()' });

// the fight again, the boar kept in frame (the alpha 2 re-cut): the herd stays calm, so the boar the player squares up to
// stands its ground through the combo instead of bolting, and the aim eases onto that one boar only
shots.push({ name: 'd-combo-calm', zone: Z, time: T, weather: W, secs: 4, warm: 120,
  setup: VIEWMODEL + CALM + tp(70, -150, yawTo(70, -150, 72, -140)),
  afterWarm: preyNear('/boar/', 3.6, -0.12),
  probe: NEAR_KINDS,
  // the struck boar bolts: the player sprints after it and strikes again as it closes
  tick: (t, i, sb, step) => js(aimAt('(window.__prey?.alive ? window.__prey : null)', 0.1, 0.35),
    ([0.2, 0.6, 1.7, 2.2, 2.7].some((T2) => at(t, T2, step)) ? 'window.__wildshard.world.weapons.tryFire();' : ''),
    (at(t, 0.8, step) ? held('move.forward') + held('sprint') : '')) });
