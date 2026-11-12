import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Animal } from './AnimalView';
import type { AnimalModel, AnimalRig } from './AnimalFactory';

/** A custom-rig creature (a Wyrm-like body: `body` + `head`, one lit body material) that a wire row stands (TE-ENG9). */
function rowBody(): { animal: Animal; fur: THREE.MeshStandardMaterial } {
  const fur = new THREE.MeshStandardMaterial({ color: 0xb4583a, emissive: 0x200804, emissiveIntensity: 0.3 });
  const hard = new THREE.MeshStandardMaterial({ color: 0xf0e0c0 });
  const body = new THREE.Bone(), head = new THREE.Bone();
  body.name = 'body'; head.name = 'head'; body.add(head);
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), [fur, hard]);
  mesh.add(body);
  const rig: AnimalRig = { mesh, bones: { body, head }, materials: [fur, hard] };
  const dims = { bodyY: 1, bodyHalfLen: 1.2, bodyRadius: 0.5, halfWidth: 0.5, legLen: 0.8 };
  const species = { label: 'Dust Wyrm', rig: 'custom', aggressive: true, animate: (): void => undefined };
  const model = { kind: 'dust-wyrm', variant: 'base', species, variantDef: { id: 'base', label: '', rarity: 'common', hp: 100 },
    dims, fur, hard } as unknown as AnimalModel;
  const animal = new Animal(rig, model, 0.25);
  animal.rowDriven = true;
  return { animal, fur };
}

function row(flinch: number, alive: boolean): Parameters<Animal['showRow']>[0] {
  return { x: 0, y: 0, z: 0, yaw: 0, state: 'idle', attack: 0, flinch, strafe: 0, brace: 0, hp: alive ? 40 : 0, alive, rise: 0, act: 0 };
}

const DT = 1 / 60;

test('a row-driven body killed during its hit flash is back at its base emissive within 0.5 s and stays there', () => {
  const { animal, fur } = rowBody();
  const base = fur.emissive.getHex(), baseI = fur.emissiveIntensity;
  let t = 0;
  const frame = (r: ReturnType<typeof row>): void => { animal.showRow(r, DT); animal.update(DT, t, true); t += DT; };
  for (let i = 0; i < 10; i++) frame(row(0, true));
  // the killing blow: the row's flinch jumps and the body dies; the server's dead body never decays that flinch again
  animal.showRow(row(1, false), DT);
  expect(fur.emissive.getHex()).not.toBe(base); // the blow itself flashes
  animal.update(DT, t, true); t += DT;
  for (let i = 0; i < 30; i++) frame(row(1, false)); // 0.5 s of the frozen dead row
  expect(fur.emissive.getHex()).toBe(base);
  expect(fur.emissiveIntensity).toBeCloseTo(baseI, 6);
  for (let i = 0; i < 120; i++) frame(row(1, false)); // and it stays there
  expect(fur.emissive.getHex()).toBe(base);
  expect(fur.emissiveIntensity).toBeCloseTo(baseI, 6);
});

test('a live row-driven body still flashes on each new blow, not between them', () => {
  const { animal, fur } = rowBody();
  const base = fur.emissive.getHex();
  let t = 0, flinch = 0;
  const show = (): void => { animal.showRow(row(flinch, true), DT); };
  const step = (): void => { animal.update(DT, t, true); t += DT; flinch *= Math.exp(-DT * 5.5); };
  for (let i = 0; i < 5; i++) { show(); step(); }
  flinch = 1; show();
  expect(fur.emissive.getHex()).not.toBe(base);
  step();
  for (let i = 0; i < 30; i++) { show(); step(); }
  expect(fur.emissive.getHex()).toBe(base);
  flinch = 1; show(); // a second blow on a still-flinching body
  expect(fur.emissive.getHex()).not.toBe(base);
});
