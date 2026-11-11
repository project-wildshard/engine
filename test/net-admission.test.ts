import { expect, test } from 'vitest';
import * as v from 'valibot';
import { BitWriter } from '../src/shared/engine/net/bits';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { decodeCommands, encodeCommands, MAX_BUNDLE, seqAfter } from '../src/shared/engine/net/command';
import { CommandQueue, COMMAND_HEADROOM, MAX_QUEUED_COMMANDS, STALL_TICKS } from '../src/server/engine/net/commandQueue';
import { localWalkingMove } from '../src/shared/engine/player/walk';
import { NetActSchema, NetCommandSchema, type NetCommand } from '@wildshard/wire/netCommand';
import { netPlayerCommand, netTickCommands } from '../src/shared/host/standalone/netInput';
import { TickCommandSchema, tickCommands } from '../src/shared/host/tickProtocol';

// P1-E5.2 (E5-REPLICATION §4.2, §9): decoded input is untrusted. Every path into the fixed tick is admitted, applied once
// and bounded, whatever a client sends.

const steer = { keyX: 0, keyY: 1, stickX: 0, stickY: 0 };
const command = (seq: number, extra: Partial<NetCommand> = {}): NetCommand => ({ seq, viewTick: 0, steer, yaw: 0, pitch: 0, buttons: 0, ...extra });
const aim = { origin: { x: 1, y: 2, z: 3 }, direction: { x: 0, y: 0, z: -1 } };
const ids = (handle: number): string | undefined => handle === 7 ? 'sunscar.home:1' : undefined;
const refs = (id: string): number => id === 'sunscar.home:1' ? 7 : 0;

test('a bundle round-trips to admitted commands in about the design size', () => {
  const writer = new BitWriter(), plain = command(1, { yaw: 1.25, pitch: -0.5, buttons: NET_BUTTONS.jump | NET_BUTTONS.sprint, steer: { keyX: -1, keyY: 0.5, stickX: 0.25, stickY: 0 } });
  const bytes = encodeCommands(writer, { ackFrame: 40, commands: [plain] }, refs);
  expect(bytes.byteLength).toBeLessThanOrEqual(6 + 14); // the header, then one command at ~14 bytes (§7)
  const decoded = decodeCommands(new Uint8Array(bytes), ids);
  expect(decoded?.ackFrame).toBe(40);
  const [out] = decoded?.commands ?? [];
  expect(v.safeParse(NetCommandSchema, out).success).toBe(true);
  expect(out?.buttons).toBe(plain.buttons);
  expect(out?.yaw).toBeCloseTo(1.25, 3); expect(out?.pitch).toBeCloseTo(-0.5, 3);
  expect(out?.steer.keyX).toBe(-1); expect(out?.steer.keyY).toBeCloseTo(0.5, 2);
  const rich = command(2, { attack: { targetId: 'sunscar.home:1', aim }, heavyTarget: 'sunscar.home:1', launcher: { slot: 3, ads: 1, fire: true } });
  expect(decodeCommands(new Uint8Array(encodeCommands(writer, { ackFrame: 1, commands: [rich] }, refs)), ids)?.commands[0]).toMatchObject({ attack: { targetId: 'sunscar.home:1', aim }, heavyTarget: 'sunscar.home:1', launcher: { slot: 3, ads: 1, fire: true } });
});

test('malformed commands are refused before they reach the queue', () => {
  const bad: unknown[] = [
    { ...command(1), yaw: Number.NaN }, { ...command(1), pitch: 4 }, { ...command(1), seq: 70000 }, { ...command(1), buttons: 65536 },
    { ...command(1), steer: { ...steer, keyX: 2 } }, { ...command(1), steer: { ...steer, stickY: Number.POSITIVE_INFINITY } },
    { ...command(1), attack: { aim: { ...aim, origin: { x: Number.NaN, y: 0, z: 0 } } } }, { ...command(1), attack: { targetId: 'bad id', aim } },
    { ...command(1), launcher: { slot: 32, ads: 0 } }, { ...command(1), launcher: { slot: 1, ads: 2 } }, { ...command(1), extra: true },
  ];
  for (const raw of bad) expect(v.safeParse(NetCommandSchema, raw).success).toBe(false);
  const queue = new CommandQueue();
  queue.admit([{ ...command(1), yaw: Number.NaN }]);
  expect(queue).toMatchObject({ refused: 1, duplicates: 0 });
  expect(queue.next().command).toBeNull();
  expect(v.safeParse(NetActSchema, { kind: 'interact', seq: 1, id: '../door' }).success).toBe(false);
  expect(v.safeParse(NetActSchema, { kind: 'reload', seq: 1, slot: 99 }).success).toBe(false);
});

test('an out-of-range steer on the wire decodes, and admission refuses it', () => {
  const writer = new BitWriter();
  const bytes = new Uint8Array(encodeCommands(writer, { ackFrame: 1, commands: [command(1)] }, refs));
  bytes[10] = 0; // keyX's byte: -128 / 127, outside any axis a client can produce
  const queue = new CommandQueue();
  queue.admit(decodeCommands(bytes, ids)?.commands ?? []);
  expect(queue.refused).toBe(1);
});

test('a bundle over its cap is refused whole, and a handle the room does not know refuses its message', () => {
  const writer = new BitWriter();
  const bytes = new Uint8Array(encodeCommands(writer, { ackFrame: 1, commands: Array.from({ length: MAX_BUNDLE }, (_, index) => command(index)) }, refs));
  bytes[5] = MAX_BUNDLE + 1;
  expect(decodeCommands(bytes, ids)).toBeNull();
  expect(() => encodeCommands(writer, { ackFrame: 1, commands: Array.from({ length: MAX_BUNDLE + 1 }, (_, index) => command(index)) }, refs)).toThrow(RangeError);
  const unknown = new Uint8Array(encodeCommands(writer, { ackFrame: 1, commands: [command(1, { heavyTarget: 'sunscar.home:1' })] }, () => 99));
  expect(decodeCommands(unknown, ids)).toBeNull();
});

test('redundancy cannot repeat a press: each seq applies once, across the 16-bit wrap', () => {
  const queue = new CommandQueue();
  queue.admit([command(0xfffe, { buttons: NET_BUTTONS.jump }), command(0xffff)]);
  queue.admit([command(0xfffe, { buttons: NET_BUTTONS.jump }), command(0xffff), command(0), command(1)]);
  expect(queue.duplicates).toBe(2);
  const seen: number[] = [];
  for (let turn = queue.next(); turn.command !== null && !turn.still && seen.length < 4; turn = queue.next()) seen.push(turn.command.seq);
  expect(seen).toEqual([0xfffe, 0xffff, 0, 1]);
  expect(queue.lastSeq).toBe(1);
  expect(seqAfter(0, 0xffff)).toBe(true); expect(seqAfter(0xffff, 0)).toBe(false); expect(seqAfter(5, 5)).toBe(false);
});

test('an empty tick steps nothing, and only the holds last through it', () => {
  const queue = new CommandQueue();
  queue.admit([command(1, { buttons: NET_BUTTONS.jump | NET_BUTTONS.sprint | NET_BUTTONS.dive | NET_BUTTONS.lock, hookTarget: 2, attack: { aim }, launcher: { slot: 2, ads: 0.5, fire: true } })]);
  expect(queue.next().command?.buttons).toBe(NET_BUTTONS.jump | NET_BUTTONS.sprint | NET_BUTTONS.dive | NET_BUTTONS.lock);
  const empty = queue.next();
  expect(empty.still).toBe(true); // J125: no command, no server step
  expect(empty.command?.buttons).toBe(NET_BUTTONS.sprint | NET_BUTTONS.dive);
  expect(empty.command?.attack).toBeUndefined();
  expect(empty.command?.launcher).toEqual({ slot: 2, ads: 0.5 });
  expect(empty.command).not.toHaveProperty('hookTarget');
  expect(queue.lastSeq).toBe(1); // an empty tick acks nothing new
});

test('a stalled client freezes for 250 ms, then steps with no input and holds nothing', () => {
  const queue = new CommandQueue();
  queue.admit([command(1, { buttons: NET_BUTTONS.heavy })]);
  queue.next();
  for (let tick = 0; tick < STALL_TICKS; tick++) expect(queue.next()).toMatchObject({ still: true, command: { buttons: NET_BUTTONS.heavy } });
  for (let tick = 0; tick < 100; tick++) expect(queue.next()).toEqual({ command: null, extra: null, still: false });
  queue.admit([command(2)]);
  expect(queue.next()).toMatchObject({ command: { seq: 2 }, still: false });
  expect(queue.next().still).toBe(true); // its stall is over: the next empty tick waits again
});

test('a client that is behind steps twice a tick until it is not, and every seq still runs once', () => {
  const queue = new CommandQueue(), run: number[] = [];
  queue.admit(Array.from({ length: 7 }, (_, index) => command(index + 1)));
  for (let tick = 0; tick < 5; tick++) { const { command: first, extra } = queue.next(); for (const step of [first, extra]) if (step !== null) run.push(step.seq); }
  expect(run).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(queue.lastSeq).toBe(7);
});

test('one client frame\'s burst is not catching up: it drains a step a tick', () => {
  const queue = new CommandQueue();
  queue.admit([command(1), command(2), command(3)]);
  for (const seq of [1, 2, 3]) expect(queue.next()).toMatchObject({ command: { seq }, extra: null, still: false });
});

test('a press, a swing and a shot never ride in a second step: only a tick\'s first command reaches the weapons', () => {
  for (const rich of [{ buttons: NET_BUTTONS.jump }, { buttons: NET_BUTTONS.lock }, { attack: { aim } }, { launcher: { slot: 1, ads: 0, fire: true as const } }]) {
    const queue = new CommandQueue();
    queue.admit([command(1), command(2, rich), command(3), command(4), command(5), command(6)]);
    expect(queue.next()).toMatchObject({ command: { seq: 1 }, extra: null });
    expect(queue.next()).toMatchObject({ command: { seq: 2 } });
  }
});

test('a flood gains no speed: steps never pass the ticks elapsed plus the headroom', () => {
  const queue = new CommandQueue();
  let seq = 0, steps = 0;
  for (let tick = 1; tick <= 600; tick++) {
    queue.admit(Array.from({ length: 16 }, () => command(++seq)));
    const { command: first, extra } = queue.next();
    steps += Number(first !== null) + Number(extra !== null);
    expect(steps).toBeLessThanOrEqual(tick + COMMAND_HEADROOM);
  }
  expect(steps).toBeGreaterThanOrEqual(600);
});

test('a client silent for a long time banks no sprint', () => {
  const queue = new CommandQueue();
  for (let tick = 0; tick < 6000; tick++) queue.next();
  let seq = 0, steps = 0;
  for (let tick = 1; tick <= 120; tick++) {
    queue.admit(Array.from({ length: 2 }, () => command(++seq)));
    const { command: first, extra } = queue.next();
    steps += Number(first !== null) + Number(extra !== null);
  }
  expect(steps).toBeLessThanOrEqual(120 + MAX_QUEUED_COMMANDS);
});

test('the SimHost adapter produces ordinary admitted tick commands with today\'s walk law', () => {
  const steered = command(1, { yaw: 0.7, steer: { keyX: 1, keyY: 1, stickX: 0, stickY: 0 }, buttons: NET_BUTTONS.jump | NET_BUTTONS.heavy, heavyTarget: 'a', attack: { targetId: 'b', aim } });
  const move = { x: 0, z: 0 }, player = netPlayerCommand(steered);
  localWalkingMove(steered.steer, steered.yaw, move);
  expect(player).toMatchObject({ kind: 'player', moveX: move.x, moveZ: move.z, yaw: 0.7, commandVersion: 1, jump: true, heavy: { targetId: 'a' }, attack: { targetId: 'b' } });
  expect('dodge' in player).toBe(false);
  expect(v.safeParse(TickCommandSchema, player).success).toBe(true);
  const commands = netTickCommands(command(2, { pitch: 0.2, launcher: { slot: 1, ads: 0.5, fire: true } }), [{ kind: 'reload', seq: 2, slot: 1 }, { kind: 'interact', seq: 2, id: 'door' }]);
  expect(commands.map(entry => entry.kind)).toEqual(['player', 'launcher', 'launcher']);
  expect(tickCommands([{ source: 'net', commands }], 8)).toHaveLength(3);
  expect(() => tickCommands([{ source: 'net', commands }], 2)).toThrow(/allowance|commandsPerTick/u);
  expect(netTickCommands(null, [])).toEqual([]);
});
