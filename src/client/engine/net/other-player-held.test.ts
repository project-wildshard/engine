// @vitest-environment happy-dom
// REMOTE-PLAYERS RP5 (Jake, 2026-11-12 17:43: "they need a sword ... I don't see his sword and stuff"): another player holds the
// item their row's slot names, drawn from this page's own first-person model of it (one copy per kit, opaque), in the
// right hand, or the left for a bow; it swaps when the slot does, and an empty slot holds nothing. Before RP5 every other player
// held one grey box blade whatever their row said.
import * as THREE from 'three';
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { NetClient } from './client';
import { heldOnOthers, kitSlots, slotKit, type HeldLook } from './heldOnOthers';
import { OtherPlayers } from './otherPlayers';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const HELD = column('held'), BOARD = column('board');

/** A client with this page at handle 1 and Jimmy at 2, his row at the origin holding `row.held`. */
function clientWith(row: { held: number; board: number }): NetClient {
  const entities = new Map([[2, { handle: 2, id: 'player-jimmy', cls: PLAYER_CLASS, initial: { name: 'Jimmy' } }]]);
  return { welcome: { handle: 1 }, entities, riders: new Map(), interpolator: { sample: (_handle: number, _tick: number, out: Float64Array) => { out.fill(0); out[HELD] = row.held; out[BOARD] = row.board; return true; } } } as unknown as NetClient;
}

/** A first-person sword as the arms rig draws it: the arms (skinned), the blade on the rig's weapon bone, the other blade hidden,
 *  its own fist, a trail ribbon with no size; the model sits where the camera holds it. */
function fpSword(): { model: THREE.Group; blade: THREE.Mesh } {
  const model = new THREE.Group(), bone = new THREE.Bone(), blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.012), new THREE.MeshBasicMaterial());
  bone.name = 'R_weapon'; bone.position.set(0.2, -0.3, -0.5); bone.rotation.set(-1.2, 0.1, 0);
  blade.name = 'sword_wood'; blade.position.set(0, 0.14, 0);
  const iron = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.012)); iron.name = 'sword_iron'; iron.visible = false;
  const arms = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 0.5, 2)); arms.name = 'arms';
  const trail = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)));
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.08)); fist.name = 'hand-right';
  bone.add(blade, iron, fist); model.add(bone, arms, trail);
  model.position.set(0.3, -0.25, -0.4); model.rotation.set(0, 0.2, 0);
  return { model, blade };
}
/** A first-person bow placed off its model's origin, where the camera holds it, its length along the view (-z). */
function fpBow(): { model: THREE.Group; limb: THREE.Mesh } {
  const model = new THREE.Group(), limb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 1.2), new THREE.MeshBasicMaterial());
  limb.name = 'bow'; limb.position.set(0.25, 0.4, -0.9); model.add(limb); model.position.set(-0.2, -0.2, -0.5);
  return { model, limb };
}

const items = (root: THREE.Object3D, mount: string): THREE.Object3D[] => root.getObjectByName(mount)?.children.filter(node => node.name === 'HeldItem') ?? [];
const meshes = (root: THREE.Object3D | undefined): THREE.Mesh[] => { const found: THREE.Mesh[] = []; root?.traverse(node => { if ('isMesh' in node) found.push(node as THREE.Mesh); }); return found; };

let unlend: () => void = () => undefined;
afterEach(() => { unlend(); });

test('a slot maps to its row by the slot map, or by kit order where a native kit has none', () => {
  const asked: string[] = [], look = (row: string): HeldLook => { asked.push(row); return { row, model: null, bow: false }; };
  const kit = ['weapon.bow', 'weapon.sabre', 'weapon.spear'];
  const mapped = slotKit(() => kitSlots(new Map([['weapon.sabre', 3], ['weapon.bow', 7]]), kit), look);
  expect([mapped(7)?.row, mapped(3)?.row, mapped(0)]).toEqual(['weapon.bow', 'weapon.sabre', null]);
  // opus-slotsync: the one numbering a page sends its swaps by and draws others' hands by
  expect([...kitSlots(new Map(), kit)]).toEqual([['weapon.bow', 0], ['weapon.sabre', 1], ['weapon.spear', 2]]);
  const native = slotKit(() => kitSlots(new Map(), kit), look);
  expect([native(1)?.row, native(3)]).toEqual(['weapon.sabre', null]);
  expect(asked).toEqual(['weapon.bow', 'weapon.sabre', 'weapon.sabre']);
});

test('another player holds the first-person item their slot names, in the right hand or a bow in the left, and swaps it', () => {
  const sword = fpSword(), bow = fpBow();
  const kit = new Map<number, HeldLook>([[0, { row: 'weapon.sword', model: sword.model, bow: false }], [1, { row: 'weapon.bow', model: bow.model, bow: true }]]);
  unlend = heldOnOthers.lend(slot => kit.get(slot) ?? null);
  const row = { held: 0, board: 0 }, scene = new THREE.Scene(), scope = new Scope('rp5-test'), others = new OtherPlayers(clientWith(row), scene, scope);
  others.frame(0, 1 / 60);
  const body = scene.getObjectByName('Player · Jimmy');
  if (body === undefined) throw new Error('no body');

  // The sword: in the right hand, the blade alone (no arms or fist, no hidden iron blade, no trail), the very geometry and material the
  // first-person view draws, placed on the hand as it sits on the rig's weapon bone.
  expect(others.shown[0]?.item).toBe('weapon.sword');
  const [held] = items(body, 'RightHandMount');
  expect(items(body, 'LeftHandMount')).toHaveLength(0);
  const parts = meshes(held);
  expect(parts.map(part => part.name)).toEqual(['sword_wood']);
  expect(parts[0]?.geometry.attributes['position']?.array).toEqual(sword.blade.geometry.attributes['position']?.array);
  expect(parts[0]?.geometry).not.toBe(sword.blade.geometry); // the view may bend its own; others' stays still
  expect([parts[0]?.material].flat().map(material => material?.transparent)).toEqual([false]);
  for (const [at, want] of (parts[0]?.position.toArray() ?? []).map((value, axis) => [value, [0, 0.14, 0][axis] ?? 0] as const)) expect(at).toBeCloseTo(want, 5);
  expect(held?.visible).toBe(true);

  // Swapped to the bow: the sword goes, the bow is in the left hand.
  row.held = 1; others.frame(1, 1 / 60);
  expect(others.shown[0]?.item).toBe('weapon.bow');
  expect(items(body, 'RightHandMount')).toHaveLength(0);
  const [bowHeld] = items(body, 'LeftHandMount');
  expect(meshes(bowHeld).map(part => part.name)).toEqual(['bow']);
  // Its model's origin is off it, so the hand holds it 10 cm up from its near end, its length up the grip's +y.
  if (bowHeld === undefined) throw new Error('no bow');
  const grip = new THREE.Box3().setFromObject(new THREE.Group().add(...bowHeld.children.map(part => part.clone()))); // in the grip's own space
  expect(grip.min.y).toBeCloseTo(-0.1, 5);
  expect(grip.max.y).toBeCloseTo(1.1, 5);
  expect(Math.abs(grip.min.x + grip.max.x)).toBeLessThan(1e-6);
  expect(Math.abs(grip.min.z + grip.max.z)).toBeLessThan(1e-6);

  // On a board the hands are empty of it; off it, it is back.
  row.board = 1; others.frame(2, 1 / 60);
  expect(items(body, 'LeftHandMount')[0]?.visible).toBe(false);
  row.board = 0; others.frame(3, 1 / 60);
  expect(items(body, 'LeftHandMount')[0]?.visible).toBe(true);

  // A slot the kit has nothing for: nothing in either hand.
  row.held = 5; others.frame(4, 1 / 60);
  expect(others.shown[0]?.item).toBe('');
  expect([...items(body, 'RightHandMount'), ...items(body, 'LeftHandMount')]).toHaveLength(0);

  // Back to the sword.
  row.held = 0; others.frame(5, 1 / 60);
  expect(others.shown[0]?.item).toBe('weapon.sword');
  // A crossing lends a new kit whose slot 0 is the bow: the hand takes it though its slot is the same, and the old copy is freed.
  const copy = meshes(items(body, 'RightHandMount')[0])[0];
  let gone = false;
  copy?.geometry.addEventListener('dispose', () => { gone = true; });
  unlend(); unlend = heldOnOthers.lend(slot => (slot === 0 ? kit.get(1) ?? null : null));
  others.frame(6, 1 / 60);
  expect(others.shown[0]?.item).toBe('weapon.bow');
  expect(gone).toBe(true);
  const freed: string[] = [];
  // The body leaves: the first-person item's own geometry and material are never freed with it.
  sword.blade.geometry.addEventListener('dispose', () => { freed.push('geometry'); });
  (sword.blade.material as THREE.Material).addEventListener('dispose', () => { freed.push('material'); });
  scope.dispose();
  expect(freed).toEqual([]);
});
