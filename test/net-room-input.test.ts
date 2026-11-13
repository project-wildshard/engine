import { expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { decodeCommands, encodeCommands } from '../src/shared/engine/net/command';
import { BitWriter } from '../src/shared/engine/net/bits';
import { decodeAct, encodeAct } from '../src/shared/engine/net/messages';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { lockedHook, type ActRoutes } from '../src/shared/engine/sim/actRoutes';
import { netInteractCommands, netRide, netTickCommands } from '../src/shared/host/standalone/netInput';
import { simPlayerCommand, tickCommands } from '../src/shared/host/tickProtocol';

// What the room's input gained in format v0.3.0: LOCK has a bit, J116's target has a place, and riding is on the wire.
const steer = { keyX: 0, keyY: 0, stickX: 0, stickY: 0 };
const command = (extra: Partial<NetCommand> = {}): NetCommand => ({ seq: 1, viewTick: 2, steer, yaw: 0, pitch: 0, buttons: 0, ...extra });
const ids = ['', 'creature.1'];
const roundTrip = (input: NetCommand): NetCommand | undefined => {
  const bytes = encodeCommands(new BitWriter(), { ackFrame: 0, commands: [input] }, id => ids.indexOf(id));
  return decodeCommands(new Uint8Array(bytes), handle => ids[handle])?.commands[0];
};
const routes = (extra: Partial<ActRoutes>): ActRoutes => ({ identities: new Map(), time: null, inside: null, tied: null, interactions: new Map(), poseInputs: new Set<string>(), equip: null, lock: null, ride: null, mountable: null, story: null, bonded: null, lean: null, launcher: null, seen: null, buy: null, board: null, wear: null, unstuck: null, climate: null, claims: new Map(), skipHeld: false, refused: 0, ...extra });

test('every button survives the wire, LOCK with them', () => {
  const buttons = Object.values(NET_BUTTONS).reduce((all, bit) => all | bit, 0);
  expect(NET_BUTTONS.lock).toBeGreaterThan(0xff);
  expect(roundTrip(command({ buttons }))?.buttons).toBe(buttons);
});

test('a command carries its lock-on target, and leaves it out when it has none', () => {
  expect(roundTrip(command({ lockTarget: 'creature.1' }))?.lockTarget).toBe('creature.1');
  expect(roundTrip(command())).not.toHaveProperty('lockTarget');
});

test('a command carries the hook it picked, and LOCK takes it to the shard\'s script actor', () => {
  expect(roundTrip(command({ hookTarget: 0 }))?.hookTarget).toBe(0);
  expect(roundTrip(command({ hookTarget: 0xffff }))?.hookTarget).toBe(0xffff);
  expect(roundTrip(command())).not.toHaveProperty('hookTarget');
  const scripts = (hookTarget?: number): number[] => netTickCommands(command({ buttons: NET_BUTTONS.lock, ...(hookTarget === undefined ? {} : { hookTarget }) }), [], routes({ lock: 'grapple.lock' })).flatMap(row => row.kind === 'script' ? [row.value] : []);
  expect(scripts().map(lockedHook)).toEqual([undefined]);
  expect(scripts(0).map(lockedHook)).toEqual([0]);
  expect(scripts(7).map(lockedHook)).toEqual([7]);
});

test.each(['offer', 'mount', 'dismount'] as const)('a ride act %s survives the wire and is not a report', action => {
  const act = { kind: 'ride', seq: 3, action } as const;
  expect(decodeAct(new Uint8Array(encodeAct(new BitWriter(), act)))).toEqual(act);
});

test('an unknown ride action refuses its message', () => {
  const bytes = new Uint8Array(encodeAct(new BitWriter(), { kind: 'ride', seq: 3, action: 'offer' }));
  bytes[bytes.length - 1] = 9;
  expect(decodeAct(bytes)).toBeNull();
});

test('LOCK lands on the shard\'s script actor, and nowhere on a shard without one', () => {
  const held = command({ buttons: NET_BUTTONS.lock });
  expect(netTickCommands(held, [], routes({ lock: 'grapple.lock' }))).toContainEqual({ kind: 'script', actorId: 'grapple.lock', value: 1 });
  expect(netTickCommands(held, [], routes({})).filter(row => row.kind === 'script')).toEqual([]);
});

test('a launcher input nothing owns is refused, and the rest of its command stands', () => {
  const held = routes({ launcher: slot => slot === 2 }), input = command({ launcher: { slot: 9, ads: 1, fire: true } });
  const launchers = (rows: ReturnType<typeof netTickCommands>): number => rows.filter(row => row.kind === 'launcher').length;
  const rows = netTickCommands(input, [{ kind: 'reload', seq: 1, slot: 9 }, { kind: 'reload', seq: 2, slot: 2 }], held);
  expect(launchers(rows)).toBe(1);
  expect(rows.filter(row => row.kind === 'player')).toHaveLength(1);
  expect(held.refused).toBe(2);
});

test('an act this world has no owner for is counted, and goes nowhere', () => {
  const held = routes({});
  expect(netTickCommands(null, [{ kind: 'equip', seq: 1, slot: 1 }], held)).toEqual([]);
  netRide(held, 'bot:1', undefined, [{ kind: 'ride', seq: 1, action: 'mount' }]);
  expect(netInteractCommands(held, [{ kind: 'interact', seq: 1, id: 'nobody' }], 'bot:1')).toEqual([]);
  expect(held.refused).toBe(3);
});

test('a lock-on target reaches the tick', () => {
  const [row] = tickCommands([{ source: 'net', commands: netTickCommands(command({ lockTarget: 'creature.1' }), []) }], 8);
  expect(row?.kind === 'player' ? simPlayerCommand(row).lockTarget : null).toBe('creature.1');
});

test('a ride act and the lean reach the taming law for who sent them', () => {
  const said: string[] = [], leaned: number[] = [];
  const ride = routes({ ride: (player, action) => { said.push(`${player}:${action}`); }, lean: (_player, lean) => { leaned.push(lean); } });
  netRide(ride, 'bot:1', undefined, [{ kind: 'ride', seq: 1, action: 'mount' }]);
  netRide(ride, 'bot:1', command({ steer: { ...steer, keyX: 1 } }), []);
  expect(said).toEqual(['bot:1:mount']); expect(leaned).toEqual([1]);
});
