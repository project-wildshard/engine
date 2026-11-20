// @vitest-environment happy-dom
// MIRROR-SALT-ZONE MSZ12: a vehicle seat's controls on phone and desktop. Seated, the `drive` input context stands the walk's
// verbs down (so ATTACK, JUMP, DODGE and the HOVER tab hide on a phone) and the seat's discs take their places: BRAKE (held on,
// the handbrake), BOOST, HORN and LEAVE. On a keyboard W and S throttle, brake and reverse, A and D steer, Shift boosts, Space
// is the handbrake and H the horn. The wire carries them as held buttons, the server reads the stick as the vehicle's own
// (whichever way the driver looks), and BRAKE stops the vehicle without reversing it.
import { afterEach, expect, test, vi } from 'vitest';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import { hudSlots } from '@wildshard/engine/ui/hudSlots';
import { DriveDiscs, SteerChip } from '@wildshard/engine/quest/view/ui';
import { netSimCommand } from '@wildshard/engine/sim/netMotion';
import { stepVehicle, vehicleAt } from '@wildshard/engine/sim/vehicle';
import type { MoverPose } from '@wildshard/format/moverPose';
import { driverStick } from '../../../server/game/plugin/vehicleRuntime';
import { INPUT_CONTEXTS } from '../inputContexts';
import { HANDBRAKE_HOLD, installVehicleRide, seatButtons } from './steerRide';

let scope: Scope | null = null;
afterEach(() => { scope?.dispose(); scope = null; document.body.innerHTML = ''; });

test('the seat\'s buttons: BOOST is sprint, BRAKE brakes and held on pulls the handbrake, the horn; the walk\'s go', () => {
  const holding = new Set<string>(), held = (action: string): boolean => holding.has(action);
  const walk = NET_BUTTONS.jump | NET_BUTTONS.dodge | NET_BUTTONS.sprint | NET_BUTTONS.crouch | NET_BUTTONS.hover | NET_BUTTONS.skip;
  expect(seatButtons(walk, held, 0)).toBe(NET_BUTTONS.skip); // a phone's stick pushed all the way (sprint) boosts no more
  holding.add('drive.boost'); expect(seatButtons(0, held, 0)).toBe(NET_BUTTONS.sprint);
  holding.clear(); holding.add('drive.brake');
  expect(seatButtons(0, held, 0)).toBe(NET_BUTTONS.brake);
  expect(seatButtons(0, held, HANDBRAKE_HOLD)).toBe(NET_BUTTONS.handbrake);
  holding.clear(); holding.add('drive.handbrake'); expect(seatButtons(0, held, 0)).toBe(NET_BUTTONS.handbrake); // Space
  holding.clear(); holding.add('drive.horn'); expect(seatButtons(0, held, 0)).toBe(NET_BUTTONS.horn);
  // the wire's command carries them to the tick
  const command = netSimCommand({ seq: 1, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: NET_BUTTONS.brake | NET_BUTTONS.handbrake | NET_BUTTONS.horn });
  expect([command.brake, command.handbrake, command.horn]).toEqual([true, true, true]);
});

test('the server reads the driver\'s stick as the vehicle\'s own, whichever way the driver looks', () => {
  const sim = (keyX: number, keyY: number, yaw: number, extra: object = {}): { tickCommand: () => ReturnType<typeof netSimCommand> } =>
    ({ tickCommand: () => ({ ...netSimCommand({ seq: 1, viewTick: 0, steer: { keyX, keyY, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 }), ...extra }) });
  // W with the view turned to the side (the chase view looking round): still full throttle, no turn
  expect(driverStick(sim(0, 1, Math.PI / 2), 'me', 0)).toEqual({ throttle: 1, turn: 0, boost: false });
  expect(driverStick(sim(-1, -1, 2.5, { sprint: true, brake: true }), 'me', 0)).toEqual({ throttle: -1, turn: -1, boost: true, brake: true });
  // a headless tape's world move with no raw stick reads along the vehicle's heading, as before
  expect(driverStick({ tickCommand: () => ({ moveX: 0, moveZ: -1, yaw: 0 }) }, 'me', 0)?.throttle).toBeCloseTo(1, 9);
});

test('BRAKE brakes to a stop and holds there, where the back stick goes on into reverse', () => {
  const handling = { speed: 22, reverse: 6, accel: 9, brake: 18, turn: 1.6, grip: 0.8, drift: 0.4, boost: 1.5, mass: 600, ground: true } as const;
  const world = { floor: () => 0, bow: 1.7, stern: 1.7, side: 0.95 };
  let braked = { ...vehicleAt({ x: 0, y: 0, z: 0 }, 0), forward: 12 }, backed = braked;
  for (let i = 0; i < 240; i++) {
    braked = stepVehicle(braked, { throttle: 0, turn: 0, boost: false, brake: true }, handling, world, 1 / 60);
    backed = stepVehicle(backed, { throttle: -1, turn: 0, boost: false }, handling, world, 1 / 60);
  }
  expect(braked.forward).toBe(0);
  expect(backed.forward).toBeLessThan(-1);
});

test('seated, the walk\'s discs give way to BRAKE, BOOST, HORN and LEAVE, and a held BRAKE goes out as the brake', () => {
  scope = new Scope('drive-controls');
  const layer = document.createElement('div'), status = document.createElement('div'); layer.className = 'ws-touch'; document.body.append(layer, status);
  hudSlots.mount(layer, status);
  for (const def of INPUT_CONTEXTS.filter(row => row.id === 'onFoot' || row.id === 'weapon.melee' || row.id === 'drive')) app.input.register(def, scope);
  app.input.push('onFoot', scope); app.input.push('weapon.melee', scope);
  const discs = new DriveDiscs(scope), systems: SystemSpec[] = [];
  const player: { yaw: number; pitch: number; position: { x: number; y: number; z: number }; seatButtons: ((buttons: number) => number) | null; ride: null; hover: boolean; swimming: boolean; wading: boolean } =
    { yaw: 0, pitch: 0, position: { x: 0, y: 0, z: 0 }, seatButtons: null, ride: null, hover: false, swimming: false, wading: false };
  let seat: { vehicle: string; seat: number } | undefined, z = 0;
  const gears: (string | undefined)[] = [];
  const port = { seatOf: () => seat, pose: (): MoverPose => ({ position: { x: 0, y: 0, z }, euler: { x: 0, y: 0, z: 0 }, enabled: true }),
    kindOf: () => ({ seats: [{ role: 'driver', at: [0, 0.9, 0] as const, pose: 'sit' as const }], handling: { speed: 20, boost: 1.5 } }) };
  installVehicleRide(() => port, { system: spec => { systems.push(spec); }, scope, player, boost: () => false,
    view: { show: ride => { gears.push(ride?.gear); }, seated: on => { discs.show(on); } } });
  const frame = (): void => { for (const system of systems) system.run(1 / 60, 0); };
  const walkLive = (): boolean[] => (['attack', 'jump', 'dodge', 'hover', 'sprint'] as const).map(action => app.input.allowed(action));
  frame();
  expect(walkLive()).toEqual([true, true, true, true, true]);
  expect(discs.shown().every(disc => !disc.show)).toBe(true);
  seat = { vehicle: 'yard.buggy:me', seat: 0 }; frame();
  expect(walkLive()).toEqual([false, false, false, false, false]); // ATTACK, JUMP, DODGE and the HOVER tab hide
  expect(app.input.allowed('use')).toBe(true); // E still gets out
  expect(discs.shown()).toEqual([{ cls: 'ws-touch-drive-brake', show: true }, { cls: 'ws-touch-drive-boost', show: true }, { cls: 'ws-touch-drive-horn', show: true }, { cls: 'ws-touch-drive-leave', show: true }]);
  expect(layer.classList.contains('ws-touch-drive-seated')).toBe(true); // the USE band's *Get out* hides behind LEAVE
  const brake = layer.querySelector('.ws-touch-drive-brake'); if (brake === null) throw new Error('No BRAKE disc');
  brake.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); frame();
  expect(player.seatButtons?.(0)).toBe(NET_BUTTONS.brake);
  for (let t = 0; t < HANDBRAKE_HOLD + 0.05; t += 1 / 60) frame();
  expect(player.seatButtons?.(0)).toBe(NET_BUTTONS.handbrake); // held on, the handbrake
  brake.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); frame();
  expect(player.seatButtons?.(0)).toBe(0);
  // the gauge's gear: N standing, D rolling forward (-z at heading 0), R rolling back
  for (let i = 0; i < 30; i++) { z -= 0.2; frame(); }
  expect(gears.at(-1)).toBe('D');
  for (let i = 0; i < 60; i++) { z += 0.2; frame(); }
  expect(gears.at(-1)).toBe('R');
  seat = undefined; frame();
  expect(walkLive()).toEqual([true, true, true, true, true]);
  expect(player.seatButtons).toBe(null);
  expect(discs.shown().every(disc => !disc.show)).toBe(true);
});

// MSZ18: the cell's edge turns a driven vehicle back; the chip says vehicles stay in the zone for a moment, once a turn-back
test('the edge\'s turn-back says vehicles stay in the zone on the chip, for a moment', () => {
  vi.useFakeTimers();
  try {
    scope = new Scope('drive-edge');
    const chip = new SteerChip(scope), systems: SystemSpec[] = [];
    let edged = true;
    const port = { seatOf: () => ({ vehicle: 'v', seat: 0 }), pose: (): MoverPose => ({ position: { x: 0, y: 0, z: 0 }, euler: { x: 0, y: 0, z: 0 }, enabled: true }),
      kindOf: () => ({ seats: [{ role: 'driver', at: [0, 0.9, 0] as const, pose: 'sit' as const }], handling: { speed: 20, boost: 1.5 } }), takeEdge: () => { const was = edged; edged = false; return was; } };
    installVehicleRide(() => port, { system: spec => { systems.push(spec); }, scope, player: { yaw: 0, pitch: 0, position: { x: 0, y: 0, z: 0 } }, boost: () => false, view: chip });
    for (const system of systems) system.run(1 / 60, 0);
    expect(chip.root.classList.contains('staying')).toBe(true);
    expect(chip.root.querySelector('.ws-quest-steer-stay')?.textContent).toBe('Vehicles stay in this zone');
    vi.advanceTimersByTime(2600);
    expect(chip.root.classList.contains('staying')).toBe(false);
  } finally { vi.useRealTimers(); }
});
