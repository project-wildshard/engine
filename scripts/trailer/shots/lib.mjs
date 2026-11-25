// The trailer's shot data and the helpers shot files use (docs/trailer.md). Restored from singleplayer
// scripts/steam-trailer/shots/lib.mjs at cf104912d3^ (Jake, G1014: "trailers in the future that should be generic") and made
// generic: a shot file is `shots/<zone slug>.mjs` exporting `shots`, an array of plain shot records keyed by the zone they
// are shot in, so any later trailer reuses them by name.
//
// A shot:
//   { name, zone, secs,                      unique kebab name; a slug on the live grid (test/pins/staging.json); seconds
//     time?, weather?,                       Debug settings written before the boot: time live|midday|golden|sunset|night,
//                                            weather live|clear|fog|rain (src/client/engine/ui/Settings.ts OPTION_VALUES)
//     singleZone?,                           true: boot `?chunk=<zone>`, the zone alone. Players never see that, so a shot
//                                            opts in by name; every other shot boots the grid as players see it and stands
//                                            in `zone`'s cell, its neighbours at the edges (Jake, AT15)
//     rig?,                                  a camera rig { keys: [{ t, p: [x,y,z], l: [x,y,z], fov?, roll? }], ease?, rel?,
//                                            relLook?, handheld?, viewmodel?, carryPlayer? }; absent: the game's own camera
//     setup?, afterWarm?, waitFor?, probe?,  in-page JS strings, run before the warm-up, after it, polled until truthy
//     warmTick?(k), tick?(t, i, sb, step),   in-page JS per warm step / per captured sub-frame (player inputs, events)
//     warm?, speed?, about? }                warm-up steps at 1/60 s (default 240); sim speed (< 1 is in-engine slow motion)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TIMES = ['live', 'midday', 'golden', 'sunset', 'night'];
export const WEATHERS = ['live', 'clear', 'fog', 'rain'];
const ROOT = join(import.meta.dirname, '../../..');

/** Every zone slug on the live grid, read from the staging pin (J507: the live pins by slug, never a stored zone). */
export function gridZones(pinFile = join(ROOT, 'test/pins/staging.json')) {
  const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
  const cells = pin.catalogue?.grid?.cells ?? pin.grid?.cells ?? [];
  return [...new Set(cells.map((/** @type {{ slug: string }} */ c) => c.slug))].sort((a, b) => a.localeCompare(b));
}

/** Why a shot is refused, or null. @param {any} s @param {readonly string[]} zones */
export function refuseShot(s, zones) {
  if (typeof s !== 'object' || s === null) return 'a shot must be an object';
  if (typeof s.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(s.name)) return `shot name ${JSON.stringify(s.name)}: lowercase kebab`;
  if (!zones.includes(s.zone)) return `${s.name}: unknown zone ${JSON.stringify(s.zone)} (not a cell on the live grid)`;
  if (!(Number(s.secs) > 0)) return `${s.name}: secs must be > 0`;
  if (s.time !== undefined && !TIMES.includes(s.time)) return `${s.name}: time ${s.time} is not one of ${TIMES.join(', ')}`;
  if (s.weather !== undefined && !WEATHERS.includes(s.weather)) return `${s.name}: weather ${s.weather} is not one of ${WEATHERS.join(', ')}`;
  if (s.rig !== undefined) {
    const keys = s.rig?.keys;
    if (!Array.isArray(keys) || keys.length < 2) return `${s.name}: a rig needs at least 2 keys`;
    for (const k of keys) if (!(Number.isFinite(k.t) && [k.p, k.l].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)))) return `${s.name}: a rig key needs t, p [x,y,z] and l [x,y,z]`;
    if (keys.some((k, i) => i > 0 && k.t <= keys[i - 1].t)) return `${s.name}: rig keys must rise in t`;
  }
  if (s.singleZone !== undefined && s.singleZone !== true) return `${s.name}: singleZone is true or absent`;
  if (s.grid !== undefined) return `${s.name}: grid is the default now; a shot of the zone alone says singleZone: true`;
  for (const f of ['setup', 'afterWarm', 'waitFor', 'probe', 'init']) if (s[f] !== undefined && typeof s[f] !== 'string') return `${s.name}: ${f} must be in-page JS (a string)`;
  for (const f of ['tick', 'warmTick']) if (s[f] !== undefined && typeof s[f] !== 'function') return `${s.name}: ${f} must be a function returning in-page JS`;
  return null;
}

/** Load and check shot files: `sets` are file names under ./ (zone slugs, or any file of shots) or paths ending .mjs.
 * Throws on an unknown zone, a bad field or a duplicate name. @param {readonly string[]} sets */
export async function loadShots(sets, zones = gridZones()) {
  const shots = [], seen = new Set();
  for (const set of sets) {
    const url = set.endsWith('.mjs') ? new URL(set, `file://${process.cwd()}/`).href : new URL(`${set}.mjs`, import.meta.url).href;
    const mod = await import(url);
    if (!Array.isArray(mod.shots)) throw new Error(`${set}: exports no shots array`);
    for (const s of mod.shots) {
      const why = refuseShot(s, zones);
      if (why !== null) throw new Error(`${set}: ${why}`);
      if (seen.has(s.name)) throw new Error(`${set}: duplicate shot ${s.name}`);
      seen.add(s.name); shots.push(s);
    }
  }
  return shots;
}

/** The page a shot boots: the grid (the title's MMO card, as players come in) unless it says singleZone: true, the only
 * way to `?chunk=`. @param {string} base @param {{ zone: string, singleZone?: boolean }} s */
export function bootUrl(base, s) {
  const root = base.replace(/\/?$/u, '/');
  return s.singleZone === true
    ? { grid: false, url: `${root}?chunk=${encodeURIComponent(s.zone)}&mute=1&skipintro=1&nolock=1&sw=0` }
    : { grid: true, url: `${root}?mute=1&nolock=1&sw=0` };
}

/** Shots that share one page load: same zone, light, weather, grid mode and init. @param {readonly any[]} shots */
export function bootGroups(shots) {
  /** @type {{ key: string, shots: any[] }[]} */
  const groups = [];
  for (const s of shots) {
    const key = [s.zone, s.time ?? 'live', s.weather ?? 'live', s.singleZone === true ? 'alone' : 'grid', s.init ?? ''].join('|');
    const g = groups.find(x => x.key === key);
    if (g) g.shots.push(s); else groups.push({ key, shots: [s] });
  }
  return groups;
}

// ── in-page helpers for shot files (strings of JS run in the game page) ────────────────────────────────────────────
// Yaw convention (Player.ts): forward = (−sin yaw, −cos yaw); yaw 0 faces −z.
export const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const ease = (x) => { const k = clamp(x); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
export const easeOut = (k) => 1 - (1 - clamp(k)) ** 3;
const W = 'window.__wildshard.world';
/** the first-person viewmodel (the held weapon and hands) */
export const NO_VIEWMODEL = `${W}.game.viewmodel.visible = false;`;
export const VIEWMODEL = `${W}.game.viewmodel.visible = true;`;
/** calm the fauna (no flee / aggro; elites ignore it) */
export const CALM = `if (${W}.animals) ${W}.animals.calm = true;`;
export const WILD = `if (${W}.animals) ${W}.animals.calm = false;`;
/** the ambient-occlusion pass off. Nalati on the grid (11-25, dev.mjs --staging and the release preview, headless Metal):
 * n8ao turns the whole frame one flat colour there, and the frame draws whole without it; the bug is in the engine's queue */
export const NO_AO = `for (const p of ${W}.game._composer?.passes ?? []) if (typeof p.configureAOPass === 'function') p.enabled = false;`;
/** place the player on the ground at x, z facing yaw / pitch (the probe's pose: streaming follows) */
export const tp = (x, z, yaw, pitch = 0) => `await window.__wildshard.pose({ x: ${x}, z: ${z}, yaw: ${yaw}, pitch: ${pitch} });`;
/** the player's look this step */
export const look = (yaw, pitch) => `${W}.player.yaw = ${yaw.toFixed(5)}; ${W}.player.pitch = ${pitch.toFixed(5)};`;
/** hold / release an input action (move.forward, move.left, sprint, jump, attack, heavy, aim, dodge, use …) */
export const held = (action, on = true) => `${W}.game.app.input.setHeld('${action}', ${on});`;
const KEY_ACTION = { KeyW: 'move.forward', KeyS: 'move.back', KeyA: 'move.left', KeyD: 'move.right', ShiftLeft: 'sprint', Space: 'jump', Mouse0: 'attack', Mouse2: 'heavy' };
export const keyDown = (k) => held(KEY_ACTION[k] ?? k, true);
export const keyUp = (k) => held(KEY_ACTION[k] ?? k, false);
/** release every action a shot can hold (the capture runs it before each shot) */
export const RELEASE_HELD = `(() => { const i = ${W}.game.app.input; for (const a of ${JSON.stringify([...new Set(Object.values(KEY_ACTION)), 'aim', 'dodge', 'use', 'crouch'])}) { try { i.setHeld(a, false); } catch {} } })();`;
/** equip a weapon by id through the probe (sword, bow, crossbow …) */
export const equip = (id) => `window.__wildshard.combat.equip('${id}');`;
/** tick(t, i, sb, step): true on the one step whose [t, t + step) holds the event time T */
export const at = (t, T, step) => T >= t - 1e-9 && T < t + step - 1e-9;
/** in-page expression: the nearest living creature whose kind matches `re` within `max` m, or null */
export const nearest = (re, max = 80) => `(() => { const w = ${W}, pp = w.player.position; return (w.animals?.animals ?? []).filter((a) => a.alive && !a.hidden && ${re}.test(a.kind) && a.position.distanceTo(pp) < ${max}).sort((a, b) => a.position.distanceTo(pp) - b.position.distanceTo(pp))[0] ?? null; })()`;
/** ease the player's look onto `v` (an in-page expression for a creature), gain k per step */
export const aimAt = (v, k = 0.12, dyAim = 0.8) => `(() => { const e = ${v}, p = ${W}.player; if (!e) return; const want = Math.atan2(-(e.position.x - p.position.x), -(e.position.z - p.position.z)); let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += d * ${k}; const dy = e.position.y + ${dyAim} - (p.position.y + 1.65), dh = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z); p.pitch += (Math.atan2(dy, dh) - p.pitch) * ${k}; })();`;
/** stand `back` m from the nearest living creature whose kind matches `re` (a regex literal string), facing it; it is
 * window.__prey for the shot's ticks */
export const preyNear = (re, back = 6, pitch = -0.04) => `{ const w = window.__wildshard.world; const pp = w.player.position; const b = (w.animals?.animals ?? []).filter((a) => a.alive && ${re}.test(a.kind)).sort((a, c) => a.position.distanceTo(pp) - c.position.distanceTo(pp))[0];
  window.__preyKind = ${re};
  if (b) { window.__prey = b; const dx = pp.x - b.position.x, dz = pp.z - b.position.z, l = Math.hypot(dx, dz) || 1, px = b.position.x + dx / l * ${back}, pz = b.position.z + dz / l * ${back};
  await window.__wildshard.pose({ x: px, z: pz, yaw: Math.atan2(-(b.position.x - px), -(b.position.z - pz)), pitch: ${pitch} }); } }`;
/** in-page: the nearest live, shown creature of preyNear's kind, found again every tick (a creature's entry can be
 * recycled once it dies, so a held reference drifts onto another body) */
export const PREY = `(() => { const w = ${W}, pp = w.player.position, re = window.__preyKind; if (!re) return null; return (w.animals?.animals ?? []).filter((a) => a.alive && !a.hidden && re.test(a.kind) && a.position.distanceTo(pp) < 40).sort((a, b) => a.position.distanceTo(pp) - b.position.distanceTo(pp))[0] ?? null; })()`;
/** what creatures are near, for meta.json */
export const NEAR_KINDS = `(() => { const w = ${W}, p = w.player.position; return { at: [p.x, p.y, p.z].map(v => +v.toFixed(1)), kinds: [...new Set((w.animals?.animals ?? []).filter((a) => a.alive && a.position.distanceTo(p) < 120).map((a) => a.kind))] }; })()`;
/** join in-page JS snippets */
export const js = (...parts) => parts.join('');

/** Node side: a rig's pose at shot time t, the same sampling as capture.mjs's in-page pose (Catmull-Rom through the keys,
 * eased in-out when `rig.ease`), without the hand-held breath. Absolute rigs only (no `rel`). */
export const rigAt = (rig, t) => {
  const keys = rig.keys, n = keys.length, t0 = keys[0].t, t1 = keys[n - 1].t;
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
  const T = rig.ease ? t0 + easeIO(clamp((t - t0) / (t1 - t0))) * (t1 - t0) : t;
  const cr = (p0, p1, p2, p3, u) => { const u2 = u * u, u3 = u2 * u; return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3); };
  const sample = (field) => {
    if (T <= t0) return keys[0][field];
    if (T >= t1) return keys[n - 1][field];
    let i = 0; while (i < n - 2 && T > keys[i + 1].t) i++;
    const a = keys[Math.max(0, i - 1)], b = keys[i], c = keys[i + 1], d = keys[Math.min(n - 1, i + 2)];
    const u = (T - b.t) / (c.t - b.t);
    return [0, 1, 2].map((j) => cr(a[field][j], b[field][j], c[field][j], d[field][j], u));
  };
  return { p: sample('p'), l: sample('l') };
};
