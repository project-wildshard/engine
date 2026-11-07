/** Client-only boss attachments over actual actor joints and native FK queries. */
import * as THREE from 'three';
import * as v from 'valibot';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { Scope } from '@wildshard/engine/app/scope';
import { BossSocketRigSchema, type BossSocketRigRows } from '@wildshard/format/bossSocketRig';
import { bindLimbQueryView } from '../animation/limbQueryView';
import { SceneHandles } from '../shardfile/sceneHandles';
import type { ShardContext } from '../plugin/context';
import { createModelLibrary, type ModelLibrary } from '../plugin/geometry';
import { RoamingCombatSchema } from '@wildshard/format/roamingCombat';
import type { ModelContext } from '@wildshard/engine/models/model';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { loadFirstPartyProduct } from '../shardfile/runtimeProduct';

function kitOwnerEntered(scope: Scope): boolean { return !scope.disposed; }

interface Kit { readonly rows: BossSocketRigRows; readonly resources: SceneHandles }
const kits = new WeakMap<Scope, Map<string, Kit>>();
function socketLibrary(rows: BossSocketRigRows, url: string): ModelLibrary<never, never> {
  return createModelLibrary({ meshes: [], meshUrls: {}, hd: [], hdUrls: {}, hdLooks: {}, aoFloor: 1, geometryPools: [{ url, parts: rows.pool.parts }] }, 'boss socket kit');
}
/** The kit's borrowed geometries and its materials on `sky`; `own` takes each material's lifetime. */
function socketResources(rows: BossSocketRigRows, library: ModelLibrary<never, never>, sky: SkyRig, own?: (material: THREE.Material) => void): SceneHandles {
  const resources = new SceneHandles(sky);
  for (const id of rows.pool.parts) {
    const geometry = library.geometry(id, { borrow: true });
    if (geometry === null) throw new Error(`Missing boss socket geometry ${id}`); resources.publish(id, geometry);
  }
  for (const row of rows.materials) {
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(...row.colour), emissive: new THREE.Color(...row.emissive),
      emissiveIntensity: row.gain, roughness: row.roughness, metalness: row.metalness, fog: row.fog });
    if (row.lit) sky.setupMaterial(material); resources.publish(row.id, material); own?.(material);
  }
  return resources;
}
/** Preload the immutable source geometry and materials named by the row. */
export async function prepareBossSocketRig(ctx: ShardContext, input: unknown): Promise<void> {
  const rows = v.parse(BossSocketRigSchema, input), book = kits.get(ctx.scope) ?? new Map<string, Kit>();
  if (ctx.scope.disposed || book.has(rows.id)) throw new Error('Duplicate or disposed boss socket kit');
  const library = socketLibrary(rows, ctx.product.url(rows.pool.url));
  await library.preload();
  if (!kitOwnerEntered(ctx.scope)) throw new Error('Boss socket kit left during admission');
  const sky = ctx.game.runtime?.world?.sky;
  if (sky === undefined) throw new Error('Boss socket kit requires its entered sky');
  const resources = socketResources(rows, library, sky, material => { ctx.scope.own(material); });
  book.set(rows.id, { rows, resources }); kits.set(ctx.scope, book); ctx.scope.onDispose(() => { book.delete(rows.id); });
}
/** Resolve immutable named sources for detached projections of the same rig. */
export function bossSocketResources(scope: Scope, id: string): SceneHandles {
  const kit = kits.get(scope)?.get(id); if (scope.disposed || kit === undefined) throw new Error('Missing boss socket kit'); return kit.resources;
}
/** A native socket/weak-point projection, also usable by model specimens. */
export class BossSocketRig {
  private readonly parts = new Map<string, THREE.Object3D>();
  private readonly attachments: THREE.Group[] = [];
  private readonly collision;
  private glow = 1;
  private live = true;
  readonly focusRadius: number;
  constructor(private readonly actor: Animal, private readonly rows: BossSocketRigRows, private readonly resources: SceneHandles) {
    const sockets = rows.attachments.map(row => {
      const socket = actor.mesh.getObjectByName(row.socket); if (socket === undefined) throw new Error(`Missing native boss socket ${row.socket}`); return socket;
    });
    for (const row of rows.attachments) for (const mesh of row.meshes) { resources.geometry(mesh.geometry); resources.standard(mesh.material); }
    const ids = rows.attachments.flatMap(row => [row.id, ...row.meshes.map(mesh => mesh.id)]);
    if (new Set(ids).size !== ids.length || !ids.includes(rows.focus) || rows.hazards.some(id => !ids.includes(id))
      || rows.opening.some(row => !ids.includes(row.part))) throw new Error('Invalid boss socket references');
    for (const row of [...rows.glow, ...rows.emission]) resources.standard(row.material);
    this.collision = bindLimbQueryView(actor, rows.collision); this.focusRadius = rows.radius * actor.scale;
    for (const [i, row] of rows.attachments.entries()) {
      const socket = sockets[i]; if (socket === undefined) throw new Error('Missing preflighted boss socket');
      const group = new THREE.Group(); group.name = row.name; group.position.fromArray(row.at); this.parts.set(row.id, group);
      for (const mesh of row.meshes) {
        const view = new THREE.Mesh(resources.geometry(mesh.geometry), resources.standard(mesh.material));
        view.castShadow = false; group.add(view); this.parts.set(mesh.id, view);
      }
      socket.add(group); this.attachments.push(group);
    }
  }
  hazardWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    const id = this.rows.hazards[i], part = id === undefined ? undefined : this.parts.get(id);
    if (part === undefined) return out.copy(this.actor.position);
    part.getWorldPosition(out); this.collision.publishHead(); return out;
  }
  setHazardsHung(on: boolean): void { for (const id of this.rows.hazards) { const part = this.parts.get(id); if (part !== undefined) part.visible = on; } }
  focusWorld(out: THREE.Vector3): THREE.Vector3 {
    this.parts.get(this.rows.focus)?.getWorldPosition(out); this.collision.publishRibs(); return this.collision.query.ribs(out);
  }
  setGlow(gain: number): void { this.glow = gain; for (const row of this.rows.glow) this.resources.standard(row.material).emissiveIntensity = row.gain * gain; }
  setOpen(open: number, time: number): void {
    for (const row of this.rows.opening) {
      const part = this.parts.get(row.part); if (part === undefined) throw new Error('Missing preflighted opening part');
      const wave = Math.sin(time * row.frequency);
      part.scale.set((1 + row.scale[0] * open) * (1 + row.breathe[0] * wave), (1 + row.scale[1] * open) * (1 + row.breathe[1] * wave), (1 + row.scale[2] * open) * (1 + row.breathe[2] * wave));
    }
    for (const row of this.rows.emission) this.resources.standard(row.material).emissiveIntensity = this.glow * (row.base + row.open * open);
  }
  dispose(): void { if (!this.live) return; this.live = false; this.collision.dispose(); for (const part of this.attachments) part.removeFromParent(); this.parts.clear(); }
}
/** Borrow the prepared kit by id. The actor retains its actual skeleton. */
export function bindBossSocketRig(scope: Scope, id: string, actor: Animal): BossSocketRig {
  const kit = kits.get(scope)?.get(id); if (scope.disposed || kit === undefined) throw new Error('Missing boss socket kit');
  return new BossSocketRig(actor, kit.rows, kit.resources);
}
interface CardKit { readonly rows: BossSocketRigRows; readonly library: ModelLibrary<never, never> }
/**
 * A model card's copy of a roaming boss's socket rig, from the product's roaming combat rows: `preload` admits the rows
 * once and preloads the kit on every call (a world exit retires the borrowed parts; a warm call reads nothing), `dress`
 * hangs the attachments on a specimen at full glow, its resources once per card context.
 */
export class SocketRigCard {
  private kit: CardKit | null = null;
  private admission: Promise<CardKit> | null = null;
  constructor(private readonly slug: string, private readonly file: string) {}
  async preload(): Promise<void> {
    const admission = this.admission ??= (async (): Promise<CardKit> => {
      const product = await loadFirstPartyProduct(this.slug), rows = v.parse(RoamingCombatSchema, await product.json(this.file)).projection.socketRig;
      return { rows, library: socketLibrary(rows, product.url(rows.pool.url)) };
    })();
    let kit: CardKit;
    try { kit = await admission; } catch (error: unknown) { if (this.admission === admission) this.admission = null; throw error; }
    await kit.library.preload(); this.kit = kit;
  }
  dress(actor: Animal, ctx: Pick<ModelContext, 'sky' | 'once'>): BossSocketRig {
    const kit = this.kit; if (kit === null) throw new Error(`[${this.slug}] boss socket card is not preloaded`);
    return new BossSocketRig(actor, kit.rows, ctx.once(`${kit.rows.id}:card`, () => socketResources(kit.rows, kit.library, ctx.sky)));
  }
}
