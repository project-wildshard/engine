import { expect, it } from 'vitest';
import { bindHeadlessCommands } from './headlessRuntime';
import type { HeadlessCommand, HeadlessEffect } from '../../shared/host/tickProtocol';

it('keeps ordered native tick inputs, releases and effects without retaining a previous tape', () => {
  let tape: readonly HeadlessCommand[] = [
    { kind: 'player', moveX: 0, moveZ: 0, yaw: 0, attack: { targetId: 'first' }, heavy: { targetId: 'held' } },
    { kind: 'script', actorId: 'pick', value: 3 },
    { kind: 'script', actorId: 'other', value: 9 },
    { kind: 'player', moveX: 3, moveZ: 4, yaw: 0, attack: { targetId: 'second' } },
    { kind: 'script', actorId: 'pick', value: 0 },
  ];
  const effects: HeadlessEffect[] = [], ports = bindHeadlessCommands({ commands: () => tape, emit: effect => { effects.push(effect); } });
  const scripts = ports.scripts(['pick']), allScripts = ports.scripts();
  expect(ports.shots()).toEqual(['first', 'second']);
  expect(ports.heavy()).toEqual({ targetId: 'held' });
  expect(ports.lastScript('pick', null)).toBe(0);
  expect(ports.lastScript('absent', 7)).toBe(7);
  expect(scripts().map(row => row.value)).toEqual([3, 0]);
  expect(allScripts().map(row => row.actorId)).toEqual(['pick', 'other', 'pick']);
  expect(ports.melee()).toEqual({ attack: 'second', heavy: false, heavyTarget: null, swing: false });
  expect(ports.walk(5)).toEqual({ x: 3, z: 4 });
  ports.ledger.fact('entered', 'player'); ports.ledger.coins(2, 'reward');
  expect(effects).toEqual([{ kind: 'fact', name: 'entered', actorId: 'player' }, { kind: 'coins', amount: 2, actorId: 'reward' }]);
  tape = [{ kind: 'player', moveX: 0.25, moveZ: 0, yaw: 0, heavy: {} }, { kind: 'player', moveX: 0, moveZ: 0, yaw: 0 }];
  expect(ports.melee()).toEqual({ attack: null, heavy: false, heavyTarget: null, swing: false });
  expect(ports.walk(5)).toEqual({ x: 0, z: 0 });
  tape = [];
  expect(ports.shots()).toEqual([]); expect(ports.heavy()).toBeNull(); expect(scripts()).toEqual([]);
  expect(ports.lastScript('pick', null)).toBeNull();
  expect(ports.melee()).toEqual({ attack: null, heavy: false, heavyTarget: null, swing: false });
  tape = Array.from({ length: 1025 }, () => ({ kind: 'script', actorId: 'pick', value: 1 }));
  expect(() => ports.shots()).toThrow('Tick commands exceed the protocol allowance');
  expect(() => ports.lastScript('pick', null)).toThrow('Tick commands exceed the protocol allowance');
  expect(() => ports.melee()).toThrow('Tick commands exceed the protocol allowance');
});
