import { afterEach, expect, test } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { app } from '../src/client/engine/app/runtime';
import { Scope } from '../src/shared/engine/app/scope';
import { InputService } from '../src/client/engine/input/InputService';
import { LockOnSystem, aimPoint } from '../src/client/engine/player/LockOnTarget';
import { lockOn, type AimTarget } from '../src/client/engine/player/AimTargets';
import { combatBarPoint, type CombatTarget } from '../src/client/engine/ui/Combat';
import { routeLockTab } from '../src/client/game/session/lockTab';
import { INPUT_CONTEXTS } from '../src/client/game/inputContexts';
import { legacyDouble } from '../src/test/engine/FakeGame';
import type { Player } from '../src/client/engine/player/Player';
import type { EquipmentService } from '../src/client/engine/combat/EquipmentService';
import { SWORD_WOOD } from '../src/shared/game/weapons/starterMeleeProfile';

const cleanup: Scope[] = [];
afterEach(() => { for (const scope of cleanup.splice(0).reverse()) scope.dispose(); lockOn.state = 'off'; lockOn.target = null; lockOn.point = 0; });
function fixture(names: string[] = ['head', 'hand.L', 'chest']) {
  const scope = new Scope('creature-lock-points'); cleanup.push(scope);
  const input = new InputService(() => 1000), camera = new PerspectiveCamera(60, 1, .1, 100); camera.position.set(0, 1.68, 0);
  const player = legacyDouble<Player>({ preUpdate: () => undefined, position: new Vector3(), camera, yaw: Math.PI, pitch: 0, locked: true, swimming: false, hover: false });
  const equipment = legacyDouble<EquipmentService>({ enabled: true, current: legacyDouble<EquipmentService['current']>({ row: SWORD_WOOD }) });
  const target: AimTarget & CombatTarget = { position: new Vector3(0, 0, 7), scale: 1, alive: true, hidden: false, lockable: true,
    kind: 'fixture', label: 'Fixture', hp: 100, maxHp: 100, lastHitT: 0, mem: {}, dims: { bodyY: .5, bodyRadius: .3 },
    headWorld: out => out.set(0, 99, 7), lockPoints: { names, point: (index, out) => out.set(index, 2 - index * .5, 7) } };
  const targets = [target];
  scope.expose(app, 'levelScope', scope); scope.expose(app, 'input', input); scope.expose(app, 'physics', null); scope.expose(app, 'aimTargets', targets);
  for (const def of INPUT_CONTEXTS) input.register(def, scope); input.push('onFoot', scope);
  const system = scope.run(() => new LockOnSystem(player, equipment, camera));
  system.resolveToggle(); expect(lockOn.target).toBe(target);
  const key = (code: string): void => { input.executeCommand({ kind: 'physical', code, on: true, at: 1000 }); routeLockTab(input, system, false); input.executeCommand({ kind: 'physical', code, on: false, at: 1000 }); };
  return { input, player, target, targets, system, key, scope };
}
test('physical Tab cycles three sockets and wraps while camera, bar and entity identity agree', () => {
  const f = fixture(), identity = lockOn.target;
  for (const point of [0, 1, 2, 0]) {
    expect(lockOn.point).toBe(point); expect(lockOn.target).toBe(identity);
    const camera = aimPoint(f.target, new Vector3()), bar = combatBarPoint(f.target, new Vector3());
    expect(camera.toArray()).toEqual([point, 2 - point * .5, 7]); expect(bar.toArray()).toEqual(camera.toArray());
    f.key('Tab'); expect(f.input.pressed('bag')).toBe(false);
  }
});
test('single chest and legacy controls keep Bag keys; menu Tab keeps navigation', () => {
  const f = fixture(['chest']);
  expect(aimPoint(f.target, new Vector3()).toArray()).toEqual([0, 2, 7]);
  f.key('Tab'); expect(f.input.consume('bag')).toBe(true);
  f.key('KeyI'); expect(f.input.consume('bag')).toBe(true);
  f.input.push('menu', f.scope);
  f.key('Tab'); expect(f.input.consume('tab')).toBe(true); expect(f.input.pressed('bag')).toBe(false);
});
test.each(['hidden', 'dead', 'missing'] as const)('%s socket target releases its entity lock', state => {
  const f = fixture();
  if (state === 'hidden') f.target.hidden = true; else if (state === 'dead') f.target.alive = false; else f.targets.length = 0;
  expect(f.system.cyclePoint()).toBe(false); expect(lockOn.target).toBeNull(); expect(lockOn.state).toBe('off');
});
test('unlayered aim and HP anchor retain their original body/head policy', () => {
  const f = fixture(); delete f.target.lockPoints; f.system.unlock();
  expect(aimPoint(f.target, new Vector3()).toArray()).toEqual([0, .5, 7]);
  expect(combatBarPoint(f.target, new Vector3()).toArray()).toEqual([0, 99.32, 7]);
});
