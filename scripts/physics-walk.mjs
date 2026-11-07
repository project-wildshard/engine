// The baseline uses the parity autopilot input path; this function is serialized into the page.
export async function walkPhysicsLeg(legIn) {
  const w = window.__wildshard?.world, p = w.player;
  w.game.app.input.clear();
  p.velocity.set(0, 0, 0);
  // spawn() puts the feet on the terrain: under a walkway board or a ramp that is inside it — land on the top of
  // whatever static floor stands within 2.5 m over the ground there instead (a teleport, not the walk)
  const land = () => {
    const ph = w.physics, R = ph.R, x = p.position.x, z = p.position.z, top = p.position.y + 2.5;
    const hit = ph.world.castRay(new R.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }), 2.6, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (c) => c.parent()?.isFixed() ?? true);
    if (hit) p.position.y = Math.max(p.position.y, top - hit.timeOfImpact);
    p.prevFeet?.copy(p.position);
  };
  p.spawn(legIn.start.x, legIn.start.z, legIn.start.yaw);
  if (typeof legIn.start.y === 'number') p.position.y = legIn.start.y; // a deck start names its floor
  else land();
  p.pitch = -0.12;
  if (legIn.start.hover === true) p.setHover(true);
  if (w.animals.__frozen !== true) { w.animals.update = () => undefined; w.animals.__frozen = true; } // no creature in the way of the route (they are the poses' job)
  await new Promise((resolve) => { setTimeout(resolve, 600); }); // land, settle the camera
  const trace = [], stuck = [];
  let wi = 0, t = 0, jumpT = 0, jump2 = false, lastProg = { t: 0, d: Infinity }, out = 0, complete = false, timedOut = false;
  const box = legIn.inside ?? null;
  const t0 = performance.now();
  await new Promise((resolve) => {
    let stop = () => { /* assigned before the first simulation frame */ };
    let cancelDeadline = () => { /* assigned before the first simulation frame */ };
    const finish = (finished, expired = false) => {
      if (wi < 0) return;
      complete = finished; timedOut = expired;
      w.game.app.input.clear(); if (legIn.start.hover === true) p.setHover(false);
      wi = -1; cancelDeadline(); stop(); resolve(undefined);
    };
    // A closed frame gate stops dt callbacks too; it must not strand the proof.
    const deadline = setTimeout(() => { finish(false, true); }, (legIn.timeout ?? 60) * 1000);
    cancelDeadline = () => { clearTimeout(deadline); };
    stop = w.game.watchFrames((dt) => {
      if (wi >= legIn.waypoints.length || t > (legIn.timeout ?? 60)) { if (wi !== -1) finish(wi >= legIn.waypoints.length, wi < legIn.waypoints.length); return; }
      if (wi < 0) return;
      t += dt;
      const wp = legIn.waypoints[wi];
      const dx = wp.x - p.position.x, dz = wp.z - p.position.z, d = Math.hypot(dx, dz);
      trace.push([Math.round(t * 1000) / 1000, Number(p.position.x.toFixed(3)), Number(p.position.y.toFixed(3)), Number(p.position.z.toFixed(3)), Number(p.velocity.y.toFixed(2)), p.onGround ? 1 : 0, p.onPlatform ? 1 : 0, p.swimming ? 1 : 0, p.sliding ? 1 : 0, wi]);
      const q = p.position;
      if (box !== null && (q.x < box.x0 || q.x > box.x1 || q.z < box.z0 || q.z > box.z1 || q.y < box.floor)) out++;
      if (d < 0.8) { wi++; lastProg = { t, d: Infinity }; w.game.app.input.setHeld('jump', false); jumpT = 0; jump2 = false; return; }
      if (d < lastProg.d - 0.3) lastProg = { t, d };
      else if (box !== null && t - lastProg.t > 1.2) { wi++; lastProg = { t, d: Infinity }; w.game.app.input.setHeld('jump', false); jumpT = 0; jump2 = false; return; } // an escape leg: the edge held
      else if (t - lastProg.t > 2) { // no progress for 2 s: log it and skip on to the next waypoint
        const grid = window.__wildshard?.shard?.grid?.state().live;
        // A closed incoming readiness fence is not a physical snag. The same
        // leg deadline still bounds admission; failed/ready crossings do not wait.
        if (grid?.crossing.phase === 'preparing' && grid.crossing.issue === null && grid.live.current === null
          && typeof grid.crossing.target === 'string' && grid.live.pending.includes(grid.crossing.target)
          && !grid.live.residents.includes(grid.crossing.target)) { lastProg = { t, d }; return; }
        const ground = p.motor.result.groundCollider, owner = ground === null ? null : w.physics.colliderTag(ground)?.owner;
        stuck.push({ wp: wi, x: Number(p.position.x.toFixed(2)), y: Number(p.position.y.toFixed(2)), z: Number(p.position.z.toFixed(2)),
          motor: p.motor.snapshot(), water: p.waterSurfaceAt(p.position.x, p.position.z),
          // Read only on refusal, before the diagnostic fallback moves the player.
          grid,
          ground: owner !== null && typeof owner === 'object' && typeof owner.id === 'string' ? owner.id : null });
        // A diagnostic teleport into another grid frame can close gameplay's
        // readiness gate before its fixed-step interior event. Preserve the
        // refusal at the real feet instead of manufacturing that activation.
        if (grid !== undefined) { finish(false); return; }
        p.spawn(wp.x, wp.z, p.yaw); land(); wi++; lastProg = { t, d: Infinity }; return;
      }
      p.yaw = Math.atan2(-dx, -dz);
      w.game.app.input.setHeld('move.forward', true);
      const jumps = wp.jump === true ? 1 : typeof wp.jump === 'number' ? wp.jump : 0;
      if (jumps > 0 && d < (wp.jumpAt ?? 1.6) && jumpT === 0) { w.game.app.input.setHeld('jump', true); jumpT = 1; }
      else if (jumpT > 0 && jumpT++ > 3) { w.game.app.input.setHeld('jump', false); }
      // the double jump: a second press near the first one's apex
      if (jumps > 1 && jumpT > 5 && !jump2 && p.velocity.y < 1.5) { w.game.app.input.setHeld('jump', true); jump2 = true; jumpT = 1; }
      if (jumps === 0) jumpT = 0;
    });
  });
  return { trace, stuck, out, complete, timedOut, wall: Math.round(performance.now() - t0) };
}
