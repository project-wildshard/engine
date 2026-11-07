/** Client-only forest cover. Geometry and placements come from admitted rows. */
import { Group, type BufferGeometry, type Vector3 } from 'three';
import type { Forest } from '@wildshard/engine/world/forest/Forest';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { buildTier, TIER_CONFIG } from '@wildshard/engine/core/tier';
import { macrotask } from '@wildshard/engine/boot/plan';
import { workSlice } from '@wildshard/engine/core/workSlice';
import { forestGroundLayoutSteps, type ForestPageRows, type GroundPlacement } from '@wildshard/format/forestPage';
import { plumbingKnob } from '../shard/declaredPlumbing';
import type { CoverAppearance, CoverMaterial } from './coverAppearance';
import { readForestGroundInputs } from './forestGroundInputs';
import type { ShardContext } from '../plugin/context';

export interface ForestGroundDraw { readonly geometry: BufferGeometry; readonly material: CoverMaterial; readonly castShadow: boolean }
/** Output-only native field borrowed by model placement and specimen views. */
export class ForestGround {
  readonly group: Group = new Group();
  readonly kinds: Readonly<Record<string, ForestGroundDraw>>;
  readonly layout: Readonly<Record<string, GroundPlacement[]>>;
  private constructor(readonly view: Forest, private readonly sky: SkyRig, private readonly appearance: CoverAppearance,
    kinds: Record<string, ForestGroundDraw>, layout: Record<string, GroundPlacement[]>, private readonly grid: { size: number; pad: number; far: number }) { this.kinds = kinds; this.layout = layout; }
  static async prepare(ctx: ShardContext, rows: ForestPageRows['ground'], view: Forest, sky: SkyRig): Promise<ForestGround> {
    const source = ctx.product.shardfile;
    const [appearanceInput, layoutInput, geometryInput] = await readForestGroundInputs(ctx, rows);
    if (appearanceInput.status === 'rejected') throw appearanceInput.reason;
    const appearance = appearanceInput.value;
    const far = plumbingKnob(source.plumbing, buildTier(), rows.far, 'number', TIER_CONFIG), shadow = plumbingKnob(source.plumbing, buildTier(), rows.shadow, 'boolean', TIER_CONFIG);
    // admitted in steps under the work slice (a drawn frame when a grid cell prepares it in play)
    if (layoutInput.status === 'rejected') throw layoutInput.reason;
    const steps = forestGroundLayoutSteps(layoutInput.value), slice = workSlice();
    let admitted = steps.next();
    while (admitted.done !== true) { if (slice.due()) await slice.yield(); admitted = steps.next(); }
    const placements = admitted.value, layout = placements.layout;
    if (!rows.kinds.every((row, i) => layout[row.id]?.length === placements.counts[i])) throw new Error('Forest ground kind counts differ');
    if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Forest ground owner is retired');
    if (geometryInput.status === 'rejected') throw geometryInput.reason;
    const geometry = geometryInput.value;
    appearance.set('fade', [far, Math.min(25, far * .3)]); await appearance.prepare(ctx.product); await macrotask();
    const kinds: Record<string, ForestGroundDraw> = {};
    for (const row of rows.kinds) {
      const shape = geometry.get(row.geometry); if (shape === undefined || layout[row.id] === undefined) throw new Error('Missing declared forest cover kind');
      const part = appearance.geometry(row.id, shape.geometry.clone()); ctx.scope.own(part);
      kinds[row.id] = { geometry: part, material: appearance.mapped(row.id), castShadow: appearance.row.kinds.find(kind => kind.id === row.id)?.shadow === true && shadow };
    }
    return new ForestGround(view, sky, appearance, kinds, layout, { ...rows.cells, far: far + rows.cells.extraFar });
  }
  cells(): { size: number; pad: number; far: number } { return this.grid; }
  update(_dt: number, eye: Vector3): void { this.appearance.update(eye, this.group.matrixWorld, this.sky.sunColor); }
}
