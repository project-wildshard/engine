/**
 * Worn cosmetics (E314, project/archive/2026-09-30-driftwood-loot.md: the Drowned Captain's hat and the sailcloth cape, GEAR cosmetics
 * worn or taken off from the Bag). The game is first person and the player has no body mesh, so a worn thing shows
 * where a body would: in the player's SHADOW on the sand (board 4 C). `Wardrobe` hangs each worn model on its socket
 * on a root that follows the player's feet and yaw; in the default `shadow` mode its meshes draw nothing to the screen
 * (colour and depth writes off: one empty draw each) and cast their shadow as themselves — a swaying model keeps its
 * sway depth material, so the cape's shadow moves with the wind. `visible` mode draws them as they are (a mirror, a
 * third-person camera, the Bag's paper doll).
 *
 * First person: the hat's brim sits just above the eye and the cape behind the shoulders, so neither is ever in the
 * view in `shadow` mode, and nothing clips the camera. Shard-agnostic: the models come in as built objects (a shard's
 * `buildCaptainHat` / `buildSailclothCape`), each in its own space as the model contract has it.
 *
 *   const wardrobe = new Wardrobe();            scene.add(wardrobe.root);
 *   wardrobe.wear('hat', buildCaptainHat(ctx));  wardrobe.wear('cape', null);   // take the cape off
 *   // each frame, after the player moves:
 *   wardrobe.follow(player.position.x, player.position.y, player.position.z, player.yaw);
 *
 * Worn on the player's body shadow (src/engine/player/BodyShadow.ts, E314 stage 3): its `wardrobe` follows the invisible castaway,
 * and Driftwood's keepsakes (src/shards/driftwood-isle/loot/keepsakes.ts) dress it from the Owned store's worn cosmetics.
 */
import * as THREE from 'three';
import { SHADOW_LAYER } from '@wildshard/engine/core/shadowLayer';

/** where a worn model's own-space origin sits, from the player's feet (m): y up, z toward the way the player faces */
export const WEAR_SOCKET = {
  /** the hat's origin is its head band: just over the eye (Player EYE 1.68, the capsule's crown 1.8) */
  hat: { y: 1.74, z: -0.01 },
  /** the cape's origin is its hem line and its neck is 1 m over it: the neck at the shoulders' top (~1.46) */
  cape: { y: 0.46, z: 0 },
} as const;
export type WearSlot = keyof typeof WEAR_SOCKET;
export const WEAR_SLOTS: readonly WearSlot[] = ['hat', 'cape'];

/** `shadow`: seen only in the player's shadow (first person); `visible`: drawn as they are */
export type WearMode = 'shadow' | 'visible';

/** draws nothing to the screen; the shadow pass uses its own depth material, so the mesh still casts (a shadow-mode mesh is
 *  also moved to SHADOW_LAYER, so the view pass skips it altogether: no empty draw, E314 stage 3's cost pass) */
let shadowOnly: THREE.MeshBasicMaterial | null = null;
export function shadowOnlyMaterial(): THREE.MeshBasicMaterial {
  shadowOnly ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  return shadowOnly;
}

const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as Partial<THREE.Mesh>).isMesh === true;

interface SavedMesh { readonly mesh: THREE.Mesh; readonly material: THREE.Material | THREE.Material[]; readonly castShadow: boolean; readonly receiveShadow: boolean; readonly layers: number }
interface Saved { readonly parent: THREE.Object3D | null; readonly position: THREE.Vector3; readonly meshes: readonly SavedMesh[] }

export class Wardrobe {
  readonly root: THREE.Group = new THREE.Group();
  private readonly mode: WearMode;
  private readonly worn: Record<WearSlot, THREE.Object3D | null> = { hat: null, cape: null };
  /** what wearing changed on each worn object, put back when it comes off (its pose, its meshes' materials and shadow flags) */
  private readonly saved = new Map<THREE.Object3D, Saved>();

  constructor(mode: WearMode = 'shadow') {
    this.mode = mode;
    this.root.name = 'wardrobe';
  }

  /**
   * wear `object` in `slot` (replacing what was there), or take it off with null; returns what came off. Taking a thing
   * off gives it back as it came: its parent, position, and every mesh's material and shadow flags (shadow mode swaps them)
   */
  wear(slot: WearSlot, object: THREE.Object3D | null): THREE.Object3D | null {
    const prev = this.worn[slot];
    if (prev === object) return null;
    if (object !== null) for (const s of WEAR_SLOTS) if (s !== slot && this.worn[s] === object) this.wear(s, null); // one object, one slot
    if (prev) this.undress(prev);
    this.worn[slot] = object;
    if (object) this.dress(object, slot);
    return prev;
  }

  private dress(object: THREE.Object3D, slot: WearSlot): void {
    const meshes: SavedMesh[] = [];
    object.traverse((o) => {
      if (isMesh(o)) meshes.push({ mesh: o, material: o.material, castShadow: o.castShadow, receiveShadow: o.receiveShadow, layers: o.layers.mask });
    });
    this.saved.set(object, { parent: object.parent, position: object.position.clone(), meshes });
    const s = WEAR_SOCKET[slot];
    object.position.set(0, s.y, s.z);
    if (this.mode === 'shadow') {
      for (const m of meshes) {
        m.mesh.material = shadowOnlyMaterial();
        m.mesh.castShadow = true;
        m.mesh.receiveShadow = false;
        m.mesh.layers.set(SHADOW_LAYER); // drawn by the shadow pass only (src/client/engine/core/shadowLayer.ts)
      }
    }
    this.root.add(object);
  }

  private undress(object: THREE.Object3D): void {
    this.root.remove(object);
    const s = this.saved.get(object);
    if (s === undefined) return;
    this.saved.delete(object);
    object.position.copy(s.position);
    for (const m of s.meshes) {
      m.mesh.material = m.material;
      m.mesh.castShadow = m.castShadow;
      m.mesh.receiveShadow = m.receiveShadow;
      m.mesh.layers.mask = m.layers;
    }
    s.parent?.add(object);
  }

  /** what is worn in `slot` (null: nothing) */
  wearing(slot: WearSlot): THREE.Object3D | null { return this.worn[slot]; }

  /** pose the worn things on the player: feet at (x, feetY, z), facing `yaw` (Player.yaw: 0 looks toward −z). No allocation. */
  follow(x: number, feetY: number, z: number, yaw: number): void {
    this.root.position.set(x, feetY, z);
    this.root.rotation.set(0, yaw + Math.PI, 0); // a model's front is +Z; the player's forward at yaw 0 is −Z
  }
}
