// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped native player motor, not a partial Player substitute.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare every native bearing and snap field exactly on the same host.
import { deepStrictEqual } from 'node:assert';
import { expect, test } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { app } from '../src/client/engine/app/runtime';
import { AimAssist } from '../src/client/engine/player/AimAssist';
import { AimAssist as Before } from './fixtures/aim-assist-before';
import type { AimTarget } from '../src/client/engine/player/AimTargets';
import { Player } from '../src/client/engine/player/Player';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { getSetting, setSetting } from '../src/client/engine/ui/Settings';

test('every original aim winner, friction, snap, tracking and stale bearing stays exact', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), physics = new Physics(R);
  const players = [new Player(new PerspectiveCamera(), physics, document.createElement('canvas')),
    new Player(new PerspectiveCamera(), physics, document.createElement('canvas'))];
  const before = new Before(), now = new AimAssist(), previousTargets = app.aimTargets, previousSetting = getSetting('aimAssist');
  const targets: AimTarget[] = Array.from({ length: 12 }, (_, index) => ({ alive: true,
    position: new Vector3(0, 0, -10 - index), scale: 1 + index * .1,
    dims: { bodyY: .9, bodyRadius: .33, bodyHalfLen: .7 } }));
  let snapped = 0, friction = 0, removed = 0;
  try {
    for (let tick = 0; tick < 1024; tick++) {
      setSetting('aimAssist', tick % 97 !== 0);
      app.aimTargets = tick % 71 === 0 ? [] : tick % 67 === 0 ? targets.slice(0, 4) : targets;
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index]; if (target === undefined) throw new Error('Missing original aim target');
        target.position.x = tick % 53 === 0 ? 100 : Math.sin(tick * .013 + index) * (index % 3 === 0 ? .1 : .7);
        target.position.y = Math.cos(tick * .019) * .05;
        target.alive = (tick + index) % 29 !== 0; target.hidden = (tick + index) % 31 === 0;
      }
      if (tick % 31 === 0) {
        const first = targets[0], second = targets[1];
        if (first === undefined || second === undefined) throw new Error('Missing tied targets');
        second.position.copy(first.position); second.scale = first.scale ?? 1;
      }
      const nestedTarget = targets[5];
      if (nestedTarget === undefined) throw new Error('Missing nested target');
      const dt = tick % 41 === 0 ? .4 : tick % 37 === 0 ? 0 : 1 / 30, ads = tick % 43 >= 8, drag = tick % 19 === 0 ? 250 : 0;
      for (const [index, assist] of [before, now].entries()) {
        const player = players[index]; if (player === undefined) throw new Error('Missing original aim player');
        player.camera.position.set(Math.sin(tick * .01) * .1, .9, 0);
        if (tick % 23 === 0) { player.yaw = .015; player.pitch = 0; }
        if (tick % 17 === 0) assist.noteLook(tick % 2 === 0 ? 8 : -8, tick % 3 - 1);
        if (tick % 47 !== 0) delete nestedTarget.headWorld;
        else nestedTarget.headWorld = out => {
          const list = app.aimTargets; app.aimTargets = [];
          try { assist.update(.001, player, false, 0); }
          finally { app.aimTargets = list; }
          return out.copy(nestedTarget.position).addScalar(.2);
        };
        assist.update(dt, player, ads, drag);
      }
      const oldPlayer = players[0], newPlayer = players[1];
      if (oldPlayer === undefined || newPlayer === undefined) throw new Error('Missing original aim player');
      deepStrictEqual([newPlayer.yaw, newPlayer.pitch, now.lookScale()], [oldPlayer.yaw, oldPlayer.pitch, before.lookScale()]);
      for (const key of ['bearings', 'snap', 'clock', 'wasAds', 'dragX', 'dragY']) deepStrictEqual(Reflect.get(now, key), Reflect.get(before, key));
      if (Reflect.get(now, 'snap') !== null) snapped++;
      if (now.lookScale() < 1) friction++;
      if (app.aimTargets.length === 0) { deepStrictEqual(Reflect.get(now, 'bearings'), new Map()); removed++; }
    }
    expect(snapped).toBeGreaterThan(0); expect(friction).toBeGreaterThan(0); expect(removed).toBeGreaterThan(0);
  } finally {
    app.aimTargets = previousTargets; setSetting('aimAssist', previousSetting);
    for (const player of players) player.motor.dispose(); physics.dispose();
  }
});
