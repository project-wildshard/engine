import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Animal } from './AnimalView';
import type { AnimalModel, AnimalRig } from './AnimalFactory';
import { diagnosticNow } from '../../../shared/engine/core/clock';

// REMOTE-PLAYERS RP1 (Jake, 2026-11-12 17:43): "I didn't see the health bar of the bear on my side ... see the health bar going
// down as Jimmy is smacking it". Combat.ts shows a creature's bar for BAR_HOLD ms after `lastHitT`; a row-driven body only
// learns its health from its row, so a drop in the row's hp is the blow every page in range sees, whoever landed it.

function rowBody(): Animal {
  const fur = new THREE.MeshStandardMaterial({ color: 0x6b4a2e });
  const body = new THREE.Bone(), head = new THREE.Bone();
  body.name = 'body'; head.name = 'head'; body.add(head);
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), [fur]);
  mesh.add(body);
  const rig: AnimalRig = { mesh, bones: { body, head }, materials: [fur] };
  const dims = { bodyY: 1, bodyHalfLen: 1.2, bodyRadius: 0.5, halfWidth: 0.5, legLen: 0.8 };
  const species = { label: 'Bear', rig: 'custom', aggressive: true, animate: (): void => undefined };
  const model = { kind: 'bear', variant: 'base', species, variantDef: { id: 'base', label: '', rarity: 'common', hp: 100 },
    dims, fur, hard: fur } as unknown as AnimalModel;
  const animal = new Animal(rig, model, 1);
  animal.rowDriven = true;
  return animal;
}

const row = (hp: number, alive = hp > 0): Parameters<Animal['showRow']>[0] =>
  ({ x: 0, y: 0, z: 0, yaw: 0, state: 'idle', attack: 0, flinch: 0, strafe: 0, brace: 0, hp, alive, rise: 0, act: 0 });

test('a drop in a row-driven body\'s hp is a hit this page sees, whoever landed it', () => {
  const bear = rowBody();
  bear.showRow(row(100), 1 / 60);
  expect(bear.lastHitT).toBe(-Infinity);
  const before = diagnosticNow();
  bear.showRow(row(72), 1 / 60);
  expect(bear.lastHitT).toBeGreaterThanOrEqual(before);
  expect(bear.hp).toBe(72);
});

test('a body seen first already hurt, a steady row and a heal are no hit', () => {
  const bear = rowBody();
  bear.showRow(row(40), 1 / 60); // entered view after someone else's fight: no bar for an old blow
  bear.showRow(row(40), 1 / 60);
  bear.showRow(row(55), 1 / 60);
  expect(bear.lastHitT).toBe(-Infinity);
});

test('a blow after a heal is a hit: the drop counts from the last row, not the lowest', () => {
  const bear = rowBody();
  bear.showRow(row(40), 1 / 60);
  bear.showRow(row(55), 1 / 60);
  const before = diagnosticNow();
  bear.showRow(row(50), 1 / 60);
  expect(bear.lastHitT).toBeGreaterThanOrEqual(before);
});

test('the killing blow is a hit too, so the bar drains to empty in view', () => {
  const bear = rowBody();
  bear.showRow(row(30), 1 / 60);
  const before = diagnosticNow();
  bear.showRow(row(0, false), 1 / 60);
  expect(bear.lastHitT).toBeGreaterThanOrEqual(before);
  expect(bear.alive).toBe(false);
});
