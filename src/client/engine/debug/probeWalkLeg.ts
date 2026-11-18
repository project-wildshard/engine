import type { ProbePose, ProbeWorld, Vec3, WalkLeg, WalkResult } from './probe';

interface WalkControls {
  pose: (pose: ProbePose) => Promise<void>;
  land: () => void;
  told: () => void;
  point: (position: Vec3) => Vec3;
  rounded: (value: number) => number;
  now: () => number;
}

export async function walkLeg(world: ProbeWorld, leg: WalkLeg, controls: WalkControls): Promise<WalkResult> {
  const { game } = world;
  const { app } = game;
  const { pose, land, told, point, rounded, now } = controls;
  const p = world.player, held = world.animals.animals.map((a) => a.harnessHold);
  for (const a of world.animals.animals) a.harnessHold = true;
  try {
    if (!leg.inside) await pose({ ...leg.start, pitch: -0.12 });
    // on a worker page the last leg's step off is a press still on its way: this one's step on would read the old board
    if (p.link !== null) await new Promise<void>((resolve) => { app.engineScope.timeout(100, resolve); });
    if (leg.start.hover === true) p.setHover(true);
    const trace: number[][] = [], stuck: WalkResult['stuck'] = [];
    let wi = 0, t = 0, jumpT = 0, jump2 = false, lastProg = { t: 0, d: Infinity }, out = 0, maxY = p.position.y;
    const t0 = now();
    await new Promise<void>((resolve) => {
      let stop: () => void = () => { /* assigned before any simulation frame */ };
      const tick = (dt: number): void => {
        if (world.hud.paused) { game.app.input.clear(); return; }
        if (wi >= leg.waypoints.length || t > (leg.timeout ?? 60)) { game.app.input.clear(); stop(); resolve(); return; }
        t += dt; const wp = leg.waypoints[wi]; if (!wp) { stop(); resolve(); return; }
        const dx = wp.x - p.position.x, dz = wp.z - p.position.z, d = Math.hypot(dx, dz), q = p.position;
        trace.push([rounded(t), rounded(q.x), rounded(q.y), rounded(q.z), rounded(p.velocity.y), p.onGround ? 1 : 0, p.onPlatform ? 1 : 0, p.swimming ? 1 : 0, p.sliding ? 1 : 0, wi]);
        maxY = Math.max(maxY, q.y); const box = leg.inside;
        if (box && (q.x < box.x0 || q.x > box.x1 || q.z < box.z0 || q.z > box.z1 || q.y < box.floor)) out++;
        if (d < 0.8) { wi++; lastProg = { t, d: Infinity }; game.app.input.setHeld('jump', false); jumpT = 0; jump2 = false; }
        else if (d < lastProg.d - 0.3) lastProg = { t, d };
        else if (box && t - lastProg.t > 1.2) { wi++; lastProg = { t, d: Infinity }; game.app.input.setHeld('jump', false); jumpT = 0; jump2 = false; }
        else if (t - lastProg.t > (leg.stuckSeconds ?? 2)) { stuck.push({ wp: wi, ...point(q) }); p.spawn(wp.x, wp.z, p.yaw); land(); told(); wi++; lastProg = { t, d: Infinity }; }
        p.yaw = Math.atan2(-dx, -dz); game.app.input.setHeld('move.forward', true);
        const jumps = wp.jump === true ? 1 : typeof wp.jump === 'number' ? wp.jump : 0;
        if (jumps > 0 && d < (wp.jumpAt ?? 1.6) && jumpT === 0) { game.app.input.setHeld('jump', true); jumpT = 1; }
        else if (jumpT > 0 && jumpT++ > 3) game.app.input.setHeld('jump', false);
        if (jumps > 1 && jumpT > 5 && !jump2 && p.velocity.y < 1.5) { game.app.input.setHeld('jump', true); jump2 = true; jumpT = 1; }
        if (jumps === 0) jumpT = 0;
      };
      stop = world.game.watchFrames(tick);
    });
    return { name: leg.name, stuck, end: point(p.position), maxY: rounded(maxY), out, seconds: (now() - t0) / 1000, trace };
  } finally { game.app.input.clear(); if (leg.start.hover === true) p.setHover(false); world.animals.animals.forEach((a, i) => { a.harnessHold = held[i] ?? false; }); }
}
