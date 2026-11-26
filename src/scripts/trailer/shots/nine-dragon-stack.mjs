// Nine Dragon Stack (a vertical neon city), shot data for any trailer. Ported from singleplayer
// scripts/steam-trailer/shots/nine-dragon.mjs (cf104912d3^). Every key is absolute: the city stands ~125 m up a shaft, so
// a heightfield under the lens means nothing. The zone has no creatures; its play is the grapple.
import { NO_VIEWMODEL, VIEWMODEL, at, js, lerp, ease } from './lib.mjs';

const Z = 'nine-dragon-stack', T = 'night', W = 'rain';
const D = Math.PI / 180;
/** in-page: the player standing at (x, y, z), facing yaw / pitch (radians), no fall */
const stand = (x, y, z, yaw, pitch) => `{ const w = window.__wildshard.world; w.freeCamera = false; const p = w.player; p.position.set(${x}, ${y}, ${z}); p.yaw = ${yaw}; p.pitch = ${pitch}; p.velocity?.set(0, 0, 0); }`;
/** in-page: the world clock moved forward to `t` (the gondola crosses the shaft's axis at 5.167 + k * 52.36 s) */
const clockAt = (t) => `{ const g = window.__wildshard.world.game; let T = ${t}; while (T < g.clock.elapsedTime) T += 2 * Math.PI / 0.12; g.clock.elapsedTime = T; }`;
const GONDOLA_MID = 5.167;
export const shots = [
  // up the well's main shaft out of the mist, the crossings dropping past the lens, the gondola mid-frame
  { name: 'nd-rise', zone: Z, time: T, weather: W, secs: 3.6, warm: 240,
    setup: NO_VIEWMODEL, afterWarm: clockAt(GONDOLA_MID - 2.4),
    rig: { handheld: 0.2, keys: [
      { t: 0.0, p: [-14.2, 62, 8.0], l: [-13.8, 70, -30], fov: 54 },
      { t: 1.2, p: [-14.1, 70, 8.0], l: [-13.5, 79, -30], fov: 54 },
      { t: 2.4, p: [-14.0, 88, 7.9], l: [-13.1, 96, -30], fov: 54 },
      { t: 3.6, p: [-13.8, 116, 7.8], l: [-12.6, 120, -30], fov: 55 },
    ] } },
  // gliding up the stair street over the umbrellas, the signs either side
  { name: 'nd-stairs', zone: Z, time: T, weather: W, secs: 2.8, warm: 240,
    setup: NO_VIEWMODEL, afterWarm: clockAt(80),
    rig: { ease: true, handheld: 0.35, keys: [
      { t: 0.0, p: [20.6, 128.0, 5.6], l: [56, 138.5, 6.2], fov: 56 },
      { t: 2.8, p: [29.5, 132.3, 6.1], l: [56, 140.5, 6.0], fov: 55 },
    ] } },
  // play: the grapple from the well's rim: lock the gallery ring, jump, the claw carries the player across
  { name: 'nd-grapple', zone: Z, time: T, weather: W, secs: 2.8, warm: 180,
    setup: VIEWMODEL + stand(-19.5, 125, 12.25, -0.6, -0.35),
    afterWarm: js(stand(-19.5, 125, 12.25, -0.6, -0.35), 'window.__wildshard.world.lockSys.toggle();'),
    tick: (t, i, sb, step) => js(at(t, 0.24, step) ? 'window.__wildshard.world.player.touchJump = true;' : '',
      t > 1.25 ? `window.__wildshard.world.player.pitch = ${lerp(-20.05, -9, ease((t - 1.25) / 1.55)) * D};` : ''),
    probe: '(() => { const w = window.__wildshard.world; return { at: w.player.position.toArray().map((v) => +v.toFixed(1)) }; })()' },
  // the well's edge, looking down the canyon's ladder of crossings to the far gate, a slow crane up
  { name: 'nd-wide', zone: Z, time: T, weather: W, secs: 3.6, warm: 240,
    setup: NO_VIEWMODEL, afterWarm: clockAt(GONDOLA_MID - 1),
    rig: { ease: true, handheld: 0.15, keys: [
      { t: 0.0, p: [-19.5, 127.0, 9.8], l: [-19.5, 125.4, 0], fov: 61 },
      { t: 3.6, p: [-19.5, 128.6, 9.2], l: [-19.5, 127.2, -0.6], fov: 59 },
    ] } },
];
