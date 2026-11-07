import { drawSceneRows, prepareSceneDrawRows } from './sceneDraws';
import { Object3D, PointLight, Vector3, type Material } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { LightEmitters } from '@wildshard/engine/fx/lightEmitters';
import { SiteLights } from '@wildshard/engine/fx/SiteLights';
import { parseLightEmitters, type LightEmittersRows } from '@wildshard/format/lightEmitters';
import type { ShardContext } from '../plugin/context';
import { prepareClientWorld } from './runtimeProduct';
import { sceneScalar, sceneVectors } from './sceneInputs';
import type { SceneHandles } from './sceneHandles';

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
          this.direct.set(row.id, made); sites.addFlicker({ light: made, get base() { return state.lit ? light.gain : 0; }, seed: 1, kind: 'fire' });
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
    if (row.emissive !== undefined) for (const material of this.handles.materials(row.emissive.collection)) material.emissiveIntensity = lit ? row.emissive.gain : 0;
    const direct = this.direct.get(id); if (direct !== undefined) direct.intensity = lit ? row.light?.gain ?? 0 : 0;
  }
  step(time: number, eye: Vector3): void { for (const lights of this.lights) lights.step(time, eye); }
}
/** Prepare all required graph materials, bind their shared clock and install one declared emitter collection. */
export async function installLightEmitters(ctx: ShardContext, input: unknown, handles: SceneHandles, scope: Scope): Promise<void> {
  if (installed.get(scope)?.has(ctx.product.slug) === true) return;
  const rows = parseLightEmitters(input);
  for (const row of rows.rows) await prepareSceneDrawRows(ctx.product, row.draws);
  if (!ctx.product.shardfile.state.shared.some(field => field.name === rows.clock && field.privacy === 'host' && field.type === 'f64')) throw new Error('Emitter clock requires its declared host field');
  const ids = [...new Set(rows.rows.flatMap(row => row.draws.map(draw => draw.material)))];
  const prepared = await prepareClientWorld({ scope, game: ctx.game }, ctx.product.shardfile, { materials: ids, requiredMaterials: ids });
  if (prepared.graphs.readout.fallback !== 0) throw new Error('Emitter graphs did not compile');
  const clock = sceneScalar(ctx.product.slug, rows.clock);
  clock.value = 0;
  prepared.graphs.bind({ state: (part, name) => part === 'shared' && name === rows.clock ? clock.value : undefined });
  const value = new EmitterPresentation(rows, handles, ctx, scope, prepared.materials);
  ctx.app.addContentSystem({ id: `game.emitters.${String(nextCollection++)}`, phase: 'update', run: (_dt, time) => {
    clock.value = time; prepared.tick(0);
    const eye = ctx.game.runtime?.world?.player.position; if (eye !== undefined) value.step(time, eye);
  } }, scope);
}
/** Framework effect dispatch resolves the collection belonging to this resident. */
export function lightEmitterPresentation(scope: Scope, slug: string): EmitterPresentation {
  const value = installed.get(scope)?.get(slug); if (value === undefined) throw new Error('Light emitter collection is not installed'); return value;
}
