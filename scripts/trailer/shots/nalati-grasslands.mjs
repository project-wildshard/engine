// Nalati Grasslands (painterly steppe), shot data for any trailer. Ported from singleplayer
// scripts/steam-trailer/shots/nalati.mjs (cf104912d3^): the URL harness (elite=, ride=, boss=) is gone, so fights take
// the creatures the zone spawns. Rig keys: p [x, dy, z] above the ground (rel), l absolute unless relLook.
import { NO_VIEWMODEL, VIEWMODEL, CALM, WILD, held, at, aimAt, NEAR_KINDS, preyNear, js, lerp, ease, PREY } from './lib.mjs';

const Z = 'nalati-grasslands', T = 'golden', W = 'clear';
export const shots = [
  // the valley from above: a push down over the steppe to the camp, the mountains behind
  { name: 'n-open', zone: Z, time: T, weather: W, secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, ease: true, keys: [
      { t: 0, p: [40, 48, 262], l: [0, 30, 40], fov: 50 },
      { t: 4, p: [22, 20, 196], l: [-10, 12, 40], fov: 55 },
    ] } },
  // the yurt camp: a slow low drift past the tents
  { name: 'n-camp', zone: Z, time: T, weather: W, secs: 4,
    setup: NO_VIEWMODEL + CALM,
    rig: { rel: true, relLook: true, keys: [
      { t: 0, p: [66, 3.2, 190], l: [90, 2, 212], fov: 50 },
      { t: 2, p: [72, 3.6, 186], l: [90, 2, 212], fov: 50 },
      { t: 4, p: [79, 4.0, 184], l: [90, 2, 212], fov: 50 },
    ] } },
  // play: a sprint down the track on the game's own camera
  { name: 'n-run', zone: Z, time: T, weather: W, secs: 4, warm: 90,
    setup: VIEWMODEL + CALM,
    afterWarm: held('move.forward') + held('sprint'),
    tick: (t) => `window.__wildshard.world.player.pitch = ${lerp(-0.03, 0.02, ease(t / 4)).toFixed(4)};` },
  // fight: the bow drawn on whatever hunts the steppe (wolf first), loosed twice
  { name: 'n-bow', zone: Z, time: T, weather: W, secs: 4, warm: 120,
    setup: js(VIEWMODEL, WILD, 'try { window.__wildshard.combat.equip("bow"); } catch {}'),
    afterWarm: preyNear('/wolf|kokbori|boar|bear|deer|saiga|horse/', 14),
    probe: NEAR_KINDS,
    tick: (t, i, sb, step) => js(aimAt(PREY, 0.15, 0.6),
      (at(t, 0.3, step) || at(t, 2.1, step) ? held('attack') : ''),
      (at(t, 1.4, step) || at(t, 3.2, step) ? held('attack', false) : '')) },
];

// the grid crossing (TR9 of the first trailer, blocked then): booted on the grid from the title's MMO card (Driftwood is
// home, render coordinates = Driftwood's), the player on the seam road between Driftwood and Nalati (pitch 562.5 m: the
// road at x 281, Nalati's west edge at x 312.5) sprints east over the seam into Nalati with every cell near (G607)
shots.push({ name: 'g-cross', zone: Z, time: T, weather: W, secs: 4, warm: 240,
  setup: js(VIEWMODEL, CALM, 'await window.__wildshard.pose({ x: 292, z: 2, yaw: -Math.PI / 2, pitch: -0.02 });'),
  afterWarm: held('move.forward') + held('sprint'),
  probe: '(() => { const s = window.__wildshard.shard.grid.state(); return { inside: s.inside, loading: s.cellLoading, at: window.__wildshard.world.player.position.toArray().map((v) => +v.toFixed(1)) }; })()' });
// the same seam the other way: out of Nalati's grass west onto the road, Driftwood's sea ahead
shots.push({ name: 'g-cross-west', zone: Z, time: T, weather: W, secs: 4, warm: 240,
  setup: js(VIEWMODEL, CALM, 'await window.__wildshard.pose({ x: 334, z: 2, yaw: Math.PI / 2, pitch: -0.04 });'),
  afterWarm: held('move.forward') + held('sprint'),
  probe: '(() => ({ at: window.__wildshard.world.player.position.toArray().map((v) => +v.toFixed(1)) }))()' });
