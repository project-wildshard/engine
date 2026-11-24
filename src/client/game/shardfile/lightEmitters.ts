import { drawSceneRows, prepareSceneDrawRows } from './sceneDraws';
import { Group, Object3D, PointLight, Vector3, type Material } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { LightEmitters } from '@wildshard/engine/fx/lightEmitters';
import { SiteLights } from '@wildshard/engine/fx/SiteLights';
import { parseLightEmitters, type LightEmittersRows } from '@wildshard/format/lightEmitters';
import type { ShardContext } from '../plugin/context';
import { prepareClientWorld } from './runtimeFolder';
import { sceneScalar, sceneVectors } from './sceneInputs';
import { SceneHandles } from './sceneHandles';

const installed = new WeakMap<Scope, Map<string, EmitterPresentation>>();
let nextCollection = 0;
/** Client-only emitter presentation: the scene owns meshes, rows own switches, and graphs own motion. */
export class EmitterPresentation {
  private readonly states = new Map<string, { lit: boolean }>();
  private readonly pools: LightEmitters;
  private readonly groups = new Map<string, Object3D>();
  private readonly direct = new Map<string, PointLight>();
  private readonly lights: SiteLights[] = [];
  private readonly rows: LightEmittersRows;
  private readonly handles: SceneHandles;
  /** FORMAT-PRUNE FP49: each following row's scene scalar (a `weather.fields` field), its gains' factor clamped to 0..1 */
  private readonly follows = new Map<string, { value: number }>();
  constructor(rows: LightEmittersRows, handles: SceneHandles,
    ctx: ShardContext, scope: Scope, materials: ReadonlyMap<string, Material>) {
    if (installed.get(scope)?.has(ctx.product.slug) === true) throw new Error('Emitter collection already installed');
    this.rows = rows; this.handles = handles;
    const point = new Vector3();
    const poolRows = rows.rows.filter(row => row.pool !== undefined).sort((a, b) => (a.pool?.slot ?? 0) - (b.pool?.slot ?? 0));
    if (poolRows.some((row, i) => row.pool?.slot !== i)) throw new Error('Emitter pool slots must be contiguous');
    this.pools = new LightEmitters(poolRows.map(row => {
      if (row.at === undefined || row.pool === undefined) throw new Error('Emitter pool needs its point');
      const at = handles.point(row.at, point);
      return { id: row.id, at: [at.x, at.y, at.z], colour: [1, 1, 1], gain: row.pool.gain, radius: 1, cut: 1, initially: row.initially };
    }), sceneVectors(ctx.product.slug, rows.input, 4));
    const shared = new Map<string, SiteLights>();
    for (const row of rows.rows) {
      const field = followedField(row);
      if (field !== undefined) {
        if (!ctx.product.shardfile.state.shared.some(entry => entry.name === field && entry.privacy === 'host' && entry.type === 'f64')) throw new Error(`Emitter ${row.id} follows an undeclared host field: ${field}`);
        if (row.light?.shared === true) throw new Error(`Emitter ${row.id}: a shared light cannot follow a field`);
        this.follows.set(row.id, sceneScalar(ctx.product.slug, field));
      }
      const factor = (): number => this.factor(row.id);
      const group = handles.group(row.parent), state = { lit: row.initially };
      this.states.set(row.id, state); this.groups.set(row.id, group);
      drawSceneRows(ctx.product, row.draws, group, scope, materials);
      if (row.light !== undefined) {
        const light = row.light, key = JSON.stringify(light.waves);
        let sites = shared.get(key);
        const firstShared = light.shared && sites === undefined;
        if (!light.shared || sites === undefined) {
          sites = new SiteLights({ flicker: { depth: 1, waves: light.waves } }); this.lights.push(sites);
          if (light.shared) shared.set(key, sites);
        }
        if (light.shared) {
          if (light.part !== undefined) throw new Error('A shared emitter light cannot borrow an individual light');
          if (firstShared) {
            const made = sites.addLight(new PointLight(light.colour, 0, light.distance, light.decay)); ctx.root.add(made); scope.onDispose(() => { made.removeFromParent(); });
          }
          const anchor = new Object3D(); handles.point(light.at, anchor.position); ctx.root.add(anchor); scope.onDispose(() => { anchor.removeFromParent(); });
          sites.addLamp(anchor, light.colour, light.gain, light.distance, state, 'fire');
        } else {
          const made = light.part === undefined ? new PointLight(light.colour, 0, light.distance, light.decay) : handles.light(light.part);
          if (light.part === undefined) { handles.point(light.at, made.position); ctx.root.add(made); scope.onDispose(() => { made.removeFromParent(); }); }
          this.direct.set(row.id, made); sites.addFlicker({ light: made, get base() { return state.lit ? light.gain * factor() : 0; }, seed: 1, kind: 'fire' });
        }
      }
      this.set(row.id, row.initially);
    }
    scope.onDispose(() => { for (const value of sceneVectors(ctx.product.slug, rows.input, 4).value) value.w = 0; });
    let collections = installed.get(scope); if (collections === undefined) { collections = new Map(); installed.set(scope, collections); }
    collections.set(ctx.product.slug, this);
    scope.onDispose(() => { if (collections.get(ctx.product.slug) === this) collections.delete(ctx.product.slug); });
  }
  /** Quest effect identity; no simulation ownership or durable flag is introduced. */
  set(id: string, lit: boolean): void {
    const row = this.rows.rows.find(entry => entry.id === id), state = this.states.get(id), group = this.groups.get(id);
    if (row === undefined || state === undefined || group === undefined) throw new Error(`Missing emitter: ${id}`);
    state.lit = lit; group.visible = lit;
    if (row.pool !== undefined) this.pools.set(id, lit);
    this.glow(id, lit);
    const direct = this.direct.get(id); if (direct !== undefined) direct.intensity = lit ? (row.light?.gain ?? 0) * this.factor(id) : 0;
  }
  step(time: number, eye: Vector3): void {
    // FP49: a following row's emissive moves with its field every frame (its light's base reads the field in the flicker)
    for (const [id] of this.follows) this.glow(id, this.states.get(id)?.lit ?? false);
    for (const lights of this.lights) lights.step(time, eye);
  }
  /** The gains' factor: 1, or the followed field clamped to 0..1. */
  private factor(id: string): number {
    const field = this.follows.get(id); return field === undefined ? 1 : Math.min(1, Math.max(0, field.value));
  }
  private glow(id: string, lit: boolean): void {
    const emissive = this.rows.rows.find(entry => entry.id === id)?.emissive; if (emissive === undefined) return;
    for (const material of this.handles.materials(emissive.collection)) material.emissiveIntensity = lit ? emissive.gain * this.factor(id) : 0;
  }
}
/** Prepare all required graph materials, bind their shared clock and install one declared emitter collection. */
export async function installLightEmitters(ctx: ShardContext, input: unknown, handles: SceneHandles, scope: Scope): Promise<void> {
  if (installed.get(scope)?.has(ctx.product.slug) === true) return;
  const rows = parseLightEmitters(input);
  for (const row of rows.rows) await prepareSceneDrawRows(ctx.product, row.draws);
  if (!ctx.product.shardfile.state.shared.some(field => field.name === rows.clock && field.privacy === 'host' && field.type === 'f64')) throw new Error('Emitter clock requires its declared host field');
  const ids = [...new Set(rows.rows.flatMap(row => row.draws.map(draw => draw.material)))];
  const clock = sceneScalar(ctx.product.slug, rows.clock);
  clock.value = 0;
  // FP49: lights alone (a scene shard's, no draws) compile no graph
  const prepared = ids.length === 0 ? null : await prepareClientWorld({ scope, game: ctx.game }, ctx.product.shardfile, { materials: ids, requiredMaterials: ids });
  if (prepared !== null && prepared.graphs.readout.fallback !== 0) throw new Error('Emitter graphs did not compile');
  prepared?.graphs.bind({ state: (part, name) => part === 'shared' && name === rows.clock ? clock.value : undefined });
  const value = new EmitterPresentation(rows, handles, ctx, scope, prepared?.materials ?? new Map());
  ctx.app.addContentSystem({ id: `game.emitters.${String(nextCollection++)}`, phase: 'update', run: (_dt, time) => {
    clock.value = time; prepared?.tick(0);
    const eye = ctx.game.runtime?.world?.player.position; if (eye !== undefined) value.step(time, eye);
  } }, scope);
}
/** Framework effect dispatch resolves the collection belonging to this resident. */
export function lightEmitterPresentation(scope: Scope, slug: string): EmitterPresentation {
  const value = installed.get(scope)?.get(slug); if (value === undefined) throw new Error('Light emitter collection is not installed'); return value;
}

/** FORMAT-PRUNE FP49: the field a row follows. Format 0.78.0 admits it; read structurally so this engine builds against
 * the format it pins until then (an older format refuses the row, so nothing follows). */
function followedField(row: LightEmittersRows['rows'][number]): string | undefined {
  const field: unknown = Reflect.get(row, 'field');
  return typeof field === 'string' ? field : undefined;
}

/**
 * FP49: a scene shard's emitter handles. It has no `world/scenes`, so its lights hang under one group on the plan's root
 * (`scene`, which a road-entered grid cell offsets) and place from its origin (`scene.origin`) by their world offset.
 */
export function sceneShardEmitterHandles(root: Object3D, scope: Scope): SceneHandles {
  const handles = new SceneHandles(), group = new Group();
  group.name = 'scene-emitters'; root.add(group); scope.onDispose(() => { group.removeFromParent(); });
  handles.publish('scene', group); handles.publish('scene.origin', new Vector3());
  return handles;
}
