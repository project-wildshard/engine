// REMOTE-PLAYERS RP5 (meta docs/plans/REMOTE-PLAYERS-PLAN.md; Jake, 2026-11-12 17:43: "they need a sword ... I don't see his
// sword and stuff"). Another player's row names the slot they hold. This page's own kit knows what each slot is, and already
// draws it in first person: NetPlayer lends that kit here (bindWeapons), and each other player's body (otherPlayers.ts, in the
// online bundle) holds a copy of the item in its hand. The copy is taken once per kit from the first-person item's own geometry
// and materials, so nothing is rebuilt, and the bow your view bends or the crossbow it fades while you aim stays still and opaque
// in others' hands. A new kit (a crossing) frees the copies and every hand takes its item again. The state lives on the page under
// one key (as othersOnMap.ts does), so both bundles read the one kit, and three's `is*` flags stand in for `instanceof` across them.
import * as THREE from 'three';

/** A slot's item as this page draws it in first person: its row, the model its view holds, and whether it is a bow. */
export interface HeldLook { readonly row: string; readonly model: unknown; readonly bow: boolean }
/** What this page holds for one of the server's slots, or null where its kit has no such slot. */
export type HeldKit = (slot: number) => HeldLook | null;
/** An item as a hand holds it, from the kit lent as `kit`. */
export interface HeldProp { readonly row: string; readonly prop: THREE.Group; readonly hand: 'right' | 'left'; readonly kit: number }

/** The server's slot for each row a page can hold: its slot map (kit melee, levers, ranged), or, for a native kit with none
 *  (Driftwood's swords, Nalati's bow, sabre and spear), each row's place in the kit's order, which is the server's
 *  (`selection.slots`). The one numbering a page sends a swap by, follows the server's word by, and draws others' hands by. */
export function kitSlots(slots: ReadonlyMap<string, number>, kit: readonly string[]): ReadonlyMap<string, number> {
  return slots.size > 0 ? slots : new Map(kit.map((row, at) => [row, at]));
}
/** A page's kit by the server's slots (`kitSlots`). */
export function slotKit(slots: () => ReadonlyMap<string, number>, look: (row: string) => HeldLook | null): HeldKit {
  return slot => {
    for (const [row, at] of slots()) if (at === slot) return look(row);
    return null;
  };
}

/** A first-person item's own hands and sleeves (a crossbow's `hand-left-sleeve`, a longbow's `hand-right`), which the body has
 *  its own of, and the arrow the view nocks while it draws. */
const FIRST_PERSON_HANDS = /hand|arm|sleeve|fist|finger|thumb|wrist|nocked/iu;
/** Under this (in metres, on every axis) a part is a card or a ribbon (a trail, a glow), not the item. */
const SOLID = 1e-3;
/** Seconds a body waits before asking again for a slot the kit could not draw yet (its model still loading). */
const RETRY = 1;

/** `lent` counts the kits lent, so a hand knows its item is from an old one; `props` holds each model's copy, or null for none. */
interface Shared { kit: HeldKit | null; lent: number; readonly props: Map<object, THREE.Group | null> }
const KEY = Symbol.for('wildshard.heldOnOthers');
const shared = (): Shared => {
  const page = globalThis as { [KEY]?: Shared };
  page[KEY] ??= { kit: null, lent: 0, props: new Map() };
  return page[KEY];
};
/** A new kit: the old one's copies are freed (a hand still holding one lets go on its next frame). */
function renew(state: Shared, kit: HeldKit | null): void {
  for (const prop of state.props.values()) prop?.traverse(node => { if ('isMesh' in node) { const mesh = node as THREE.Mesh; mesh.geometry.dispose(); for (const material of [mesh.material].flat()) material.dispose(); } });
  state.props.clear(); state.kit = kit; state.lent++;
}
const isObject = (value: unknown): value is THREE.Object3D => typeof value === 'object' && value !== null && (value as { isObject3D?: unknown }).isObject3D === true;

/** Whether a node shows while its item does: it and every parent up to the item's root. */
function shownIn(node: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = node; at !== null && at !== root; at = at.parent) if (!at.visible) return false;
  return true;
}
/** Where a part is held from: the rig bone it rides (a weapon socket), or the item's own space. */
function socketOf(node: THREE.Object3D, root: THREE.Object3D): THREE.Object3D {
  for (let at = node.parent; at !== null && at !== root; at = at.parent) if ('isBone' in at) return at;
  return root;
}

/**
 * The parts of a first-person item a hand holds: every shown, solid, unskinned mesh (not the arms or hands, a trail or a glow card), placed
 * as it sits on its socket bone or in the item. Both spaces have the grip at the origin and +y up the blade (declaredSword.ts), as
 * the castaway's hand mounts do. Null when the item has no such part yet (its model still loading).
 */
export function heldProp(model: THREE.Object3D): THREE.Group | null {
  model.updateMatrixWorld(true);
  const prop = new THREE.Group(), at = new THREE.Matrix4(), size = new THREE.Vector3();
  prop.name = 'HeldItem';
  model.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!('isMesh' in node) || 'isSkinnedMesh' in node || 'isInstancedMesh' in node || FIRST_PERSON_HANDS.test(node.name) || !shownIn(node, model)) return;
    const materials = [mesh.material].flat();
    // A depth-only part (a firearm's own-pass depth clear) draws nothing.
    if (materials.some(material => !material.colorWrite)) return;
    const { geometry } = mesh;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    geometry.boundingBox?.getSize(size).multiply(node.getWorldScale(new THREE.Vector3()));
    if (geometry.boundingBox === null || Math.min(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)) <= SOLID) return;
    at.copy(socketOf(node, model).matrixWorld).invert().multiply(node.matrixWorld);
    // Its own copy: the view bends a bow's stave in place and fades its materials while aiming. Opaque, so it sorts as the world.
    const own = materials.map(material => Object.assign(material.clone(), { transparent: false, opacity: 1, depthWrite: true }));
    const part = new THREE.Mesh(geometry.clone(), Array.isArray(mesh.material) ? own : own[0]);
    part.name = node.name; part.castShadow = true; part.receiveShadow = true;
    at.decompose(part.position, part.quaternion, part.scale);
    prop.add(part);
  });
  if (prop.children.length === 0) return null;
  regrip(prop);
  return prop;
}

/** How far up from an item's near end the hand holds it, where its model space has no grip at its origin, in metres. */
const GRIP = 0.1;
/** Within this of an item's bounds, its origin is taken for its grip, in metres. */
const NEAR = 0.05;
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as const;
/**
 * An item whose origin is not on it (a first-person model placed off its own origin, as the camera holds it) is turned so its
 * length runs up +y, its far end up, and moved so the hand holds it GRIP up from its near end. One whose origin is on it keeps
 * its own grip and axes.
 */
function regrip(prop: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(prop), origin = new THREE.Vector3();
  if (box.clone().expandByScalar(NEAR).containsPoint(origin)) return;
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const long = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2, axis = AXES[long];
  // The far end is the one further from the origin, which sat nearer the hand.
  const sign = Math.sign(centre.getComponent(long)) || 1, turn = new THREE.Quaternion().setFromUnitVectors(axis.clone().multiplyScalar(sign), AXES[1]);
  const turned = new THREE.Matrix4().makeRotationFromQuaternion(turn);
  for (const part of prop.children) part.applyMatrix4(turned);
  box.setFromObject(prop); box.getCenter(centre);
  const moved = new THREE.Matrix4().makeTranslation(-centre.x, -GRIP - box.min.y, -centre.z);
  for (const part of prop.children) part.applyMatrix4(moved);
}

export const heldOnOthers = {
  /** This page's kit (NetPlayer.bindWeapons, and again on a crossing's slots). The call it returns takes it back. */
  lend(kit: HeldKit): () => void {
    const state = shared();
    renew(state, kit);
    return () => { if (state.kit === kit) renew(state, null); };
  },
  /** Which kit is lent: a hand holding an item from another lets go of it. */
  get lent(): number { return shared().lent; },
  /** The item in a slot as a hand holds it, made once per first-person model and kit; null where the kit has none to draw. */
  prop(slot: number): HeldProp | null {
    const state = shared(), look = state.kit?.(slot) ?? null;
    if (look === null || !isObject(look.model)) return null;
    let prop = state.props.get(look.model);
    if (prop === undefined) { prop = heldProp(look.model); state.props.set(look.model, prop); }
    return prop === null ? null : { row: look.row, prop, hand: look.bow ? 'left' : 'right', kit: state.lent };
  },
};

/** What one body holds: the item its row's slot names, in the hand that item takes, swapped as the slot changes. */
export class HeldInHand {
  private slot = Number.NaN;
  private kit = -1;
  private item: THREE.Object3D | null = null;
  private wait = 0;
  /** The row drawn, or '' for an empty hand. */
  row = '';
  private readonly hands: { readonly right: THREE.Object3D; readonly left: THREE.Object3D };
  constructor(hands: { readonly right: THREE.Object3D; readonly left: THREE.Object3D }) { this.hands = hands; }
  /** The row's slot this frame, and whether the hands are free to hold it (not on a board, in a saddle or swimming). */
  show(slot: number, free: boolean, dt: number): void {
    this.wait -= dt;
    if (slot !== this.slot || this.kit !== heldOnOthers.lent || (this.item === null && this.wait <= 0)) this.take(slot);
    if (this.item !== null) this.item.visible = free;
  }
  private take(slot: number): void {
    this.drop();
    this.slot = slot; this.kit = heldOnOthers.lent; this.wait = RETRY;
    const held = heldOnOthers.prop(slot);
    if (held === null) return;
    const item = held.prop.clone();
    (held.hand === 'left' ? this.hands.left : this.hands.right).add(item);
    this.item = item; this.row = held.row;
  }
  /** Lets go. The parts are the kit's copy, shared by every hand and freed with the kit, so nothing is freed here. */
  drop(): void { this.item?.removeFromParent(); this.item = null; this.row = ''; }
}
