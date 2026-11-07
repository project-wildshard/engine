import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { AnimalManager } from '@wildshard/engine/entities/AnimalManager';
import { bindEquipmentActors, equipmentActorOwner } from '../src/client/game/loadout/actors';

function manager(): AnimalManager {
  const value: unknown = Object.create(AnimalManager.prototype);
  if (!(value instanceof AnimalManager)) throw new Error('Missing native manager');
  return value;
}

test('target identity pins its original owner until retirement', () => {
  const scope = new Scope('equipment'), next = new Scope('replacement');
  const targets = { raycast: () => null }, animals = manager(), replacement = manager();
  try {
    bindEquipmentActors(targets, animals, scope);
    expect(equipmentActorOwner(targets).animals).toBe(animals);
    expect(equipmentActorOwner(targets).scope).toBe(scope);
    expect(() => bindEquipmentActors(targets, replacement, next)).toThrow('one live owner');
    expect(equipmentActorOwner(targets).animals).toBe(animals);
    scope.dispose();
    expect(() => equipmentActorOwner(targets)).toThrow('no native actor owner');
    bindEquipmentActors(targets, replacement, next);
    expect(equipmentActorOwner(targets).animals).toBe(replacement);
  } finally { scope.dispose(); next.dispose(); }
});

test('sliced ancestor retirement closes binding and lookup before child cleanup', () => {
  const parent = new Scope('page'), child = parent.child('equipment');
  const targets = { raycast: () => null }, later = { raycast: () => null }, animals = manager();
  bindEquipmentActors(targets, animals, child);
  parent.onDispose(() => undefined);
  const steps = parent.disposeSteps();
  try {
    expect(steps.next().done).toBe(false);
    expect(child.disposed).toBe(false);
    expect(child.disposing).toBe(true);
    expect(() => equipmentActorOwner(targets)).toThrow('no native actor owner');
    expect(() => bindEquipmentActors(later, animals, child)).toThrow('one live owner');
    expect(() => equipmentActorOwner(later)).toThrow('no native actor owner');
  } finally { for (const step of steps) void step; }
  expect(child.disposed).toBe(true);
  expect(() => equipmentActorOwner(targets)).toThrow('no native actor owner');
});

test('closed scopes and missing target sources cannot publish an owner', () => {
  const scope = new Scope('closed-equipment'), targets = { raycast: () => null };
  scope.dispose();
  expect(() => bindEquipmentActors(targets, manager(), scope)).toThrow('one live owner');
  expect(() => equipmentActorOwner(targets)).toThrow('no native actor owner');
  expect(() => equipmentActorOwner(undefined)).toThrow('no native actor owner');
});
