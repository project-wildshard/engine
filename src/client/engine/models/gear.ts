import { engineString } from '../../../shared/engine/strings';
/**
 * The gear several shards' players hold (E306 / E315 M5, category `gear`), and what every shard's gear cards share.
 *
 *   shared/iron-sword  the iron sword (src/engine/player/Sword.ts `blade: 'iron'`): the wreck's loot on Driftwood, the second sword
 *                      (Nine Dragon's kit dropped it, E314 A: nothing there unlocks it).
 *
 * A weapon's viewmodel keeps its own render queue, depth clear, layers and materials; its card is the Explorer's specimen.
 * The specimen is a SEPARATE build by the weapon's own builder (`buildSword`, a shard's `buildRifleParts`: the functions the viewmodel
 * is built with, so the two never drift) on the specimen's own materials — opaque, in the normal queue, no depth clear —
 * so nothing the Explorer does (its turntable, its paint / wire views, a skin) reaches the weapon in your hands. A shard
 * lists its gear with `live(model, { copies: 1 })` (./live.ts): one copy per weapon its kit holds.
 *
 * Also here: a skinnable weapon's legendary skins as its variants (src/client/engine/player/Skins.ts: the same material overrides a
 * drop wears, applied to the specimen's own clones), a low-poly sword's card, and the wireframe box a specimen stands as
 * while its file loads.
 */
import * as THREE from 'three';
import { applySkin, applyMaterialSkin, type SkinId, type WeaponKind, type SkinDef, type MaterialSkinDef } from '../player/Skins';
import type { SkyRig as Sky } from '../world/skyRig';
import { announceModelReady, trackSpecimenReady, type ModelVariant } from './model';
import type { Scope } from '../../../shared/engine/app/scope';


// ───────────────────────────── shared by every shard's gear ─────────────────────────────

/** a skinnable weapon's params: the legendary skin its specimen wears (null: plain) */
export interface GearSkinParams { readonly skin: SkinId | null }

/** A weapon's variants need only identity metadata: plain, then each finish in its authored order. */
export function skinVariants(kind: WeaponKind, rows: readonly Pick<SkinDef, 'id' | 'name' | 'weapon'>[]): readonly ModelVariant<GearSkinParams>[] {
  const skins = rows.filter((s) => s.weapon === kind).map((s) => ({ id: s.id, label: s.name, params: { skin: s.id } }));
  return [{ id: 'plain', label: engineString('s_8b854ade2cd0'), params: { skin: null } }, ...skins];
}

/** dress a specimen in its variant's skin: Skins.applySkin clones the materials the skin changes, for this root alone */
export function wearSkin(root: THREE.Object3D, p: GearSkinParams, rows: readonly MaterialSkinDef[]): THREE.Object3D;
export function wearSkin(root: THREE.Object3D, p: GearSkinParams, sky: Sky, rows: readonly SkinDef[]): THREE.Object3D;
export function wearSkin(root: THREE.Object3D, p: GearSkinParams, sky: Sky | readonly MaterialSkinDef[], rows?: readonly SkinDef[]): THREE.Object3D {
  if(materialRows(sky)){
    const skin=sky.find(row=>row.id===p.skin);if(skin!==undefined)applyMaterialSkin(root,skin);
  } else {
    if(rows===undefined)throw new Error('Weapon skins require their registered rows');
    const skin=rows.find(row=>row.id===p.skin);if(skin!==undefined)applySkin(root,skin,sky);
  }
  return root;
}
function materialRows(value: Sky | readonly MaterialSkinDef[]): value is readonly MaterialSkinDef[] { return Array.isArray(value); }

/** the wireframe box a specimen shows while its file loads (the training dummy's, E289) */
function loadingBox(size: readonly [number, number, number]): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> {
  const [x, y, z] = size;
  const box = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.22, wireframe: true, depthWrite: false }));
  box.position.y = y / 2;
  return box;
}

/**
 * A specimen whose parts load (a GLB): a wireframe box of about its size until `fill` resolves, then what `fill` made and a
 * `ws:model-ready` for model `id` (the Explorer re-frames and re-shoots its card). A failed load keeps the box and says why.
 */
export function loadingSpecimen(id: string, size: readonly [number, number, number], fill: () => Promise<THREE.Object3D>, owner?: Scope): THREE.Group {
  const holder = new THREE.Group();
  const box = loadingBox(size); holder.add(box);
  const placeholder = owner?.child('loading-box');
  placeholder?.own(box.geometry); placeholder?.own(box.material);
  const pending = (async (): Promise<void> => {
    try {
      const made = await fill();
      if (owner?.disposed === true) return;
      if (placeholder !== undefined) placeholder.dispose();
      else { box.geometry.dispose(); box.material.dispose(); }
      holder.clear();
      holder.add(made);
      announceModelReady(id);
    } catch (error) {
      // A closed view still cancels silently. A live failed decoder must not
      // report successful readiness to the Explorer progress display.
      if (owner?.disposed !== true && owner?.disposing !== true) {
        console.warn(`[models] ${id}: the specimen's file did not load`, error);
        throw error;
      }
    }
  })();
  trackSpecimenReady(holder, pending);
  return holder;
}
