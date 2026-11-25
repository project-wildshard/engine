// Mirror Salt (a salt-flat racing zone), shot data for any trailer. New for alpha 2 (meta ALPHA-2-TRAILER AT4): built in its
// own repo (shard-mirror-salt) with Claude Code, from a cleanroom scene into the engine. Spawn shots are relative to the
// player's spawn, as its layout moved through the cell map rework (11-21).
import { NO_VIEWMODEL, VIEWMODEL, CALM, held } from './lib.mjs';

const Z = 'mirror-salt', T = 'golden', W = 'clear';
/** in-page: a rig round the spawn, `R` m out and `H` m up, from angle a0 to a1 (radians off its facing), aimed at it */
const crane = (R, H, a0, a1, fov) => `{ const w = window.__wildshard.world, p = w.player.position.clone(), f = w.player.yaw;
  const o = (a) => [p.x - Math.sin(f + a) * ${R}, p.y + ${H}, p.z - Math.cos(f + a) * ${R}];
  window.__tr.setRig({ ease: true, keys: [{ t: 0, p: o(${a0}), l: [p.x, p.y + 2, p.z], fov: ${fov} }, { t: 4, p: o(${a1}), l: [p.x, p.y + 2, p.z], fov: ${fov} }] }); }`;
export const shots = [
  // play: across the mirror toward the arches on the game's own camera
  { name: 'm-run', zone: Z, time: T, weather: W, secs: 3.5, warm: 60, setup: VIEWMODEL + CALM, afterWarm: held('move.forward') + held('sprint') },
  // the start line: a low crane round the land yachts at the GO gate, the arches reflected in the salt
  { name: 'm-yachts', zone: Z, time: T, weather: W, secs: 4, setup: NO_VIEWMODEL + CALM, afterWarm: crane(25, 5, Math.PI + 0.6, Math.PI - 0.2, 60) },
];
