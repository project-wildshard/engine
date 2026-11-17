import type { Scope } from '@wildshard/engine/app/scope';
import { SEED, CHUNK_HALF } from '@wildshard/engine/core/config';
import * as grass from '@wildshard/format/grassField';
import { activeLevel, onLevelChange } from '@wildshard/engine/level/selection';
import { normalAt, splatAt, trailDistance, cabinMask, pondMask, waterLevel } from '@wildshard/engine/world/Heightfield';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { PopulationFieldSchema } from '@wildshard/format/populationEnvironment';
import { parse, type InferOutput } from 'valibot';

/**
 * The painterly grass *field* (SDK-SPLIT SP5b, Q35): format's `GrassField` is the law, shared with the build's meadow bake;
 * this binds the page's field to the installed terrain and the active level's paint and meadow layout.
 *
 *   grassBaseHeightAt(x, z)  metres (0 = bare: water, trail bed, rock, snow, yurt floor) — before trampling
 *   flowerPatchAt(x, z)      0..1 flower-drift strength (GrassField.sample channels: 1 tone, 3 species, 7 bloom)
 */
export class GrassField extends grass.GrassField {}
export type GrassFieldPorts = grass.GrassFieldPorts;

/** The page's field: the installed terrain (live: a baked grid installed later is read from then on) and the active level's paint. */
let layout: grass.GrassFieldLayout | null = null;
function pageField(): GrassField {
  return new GrassField({
    seed: SEED, half: CHUNK_HALF, heightAt, normalAt: (x, z, eps) => normalAt(x, z, eps), splatAt: (x, z) => splatAt(x, z),
    trailDistance: (x, z) => trailDistance(x, z), cabinMask: (x, z) => cabinMask(x, z), pondMask: (x, z) => pondMask(x, z), waterLevel: () => waterLevel(),
    paint: (x, z, y, slope, out) => {
      const level = activeLevel(), paint = level.groundColor, terrain = level.ground.terrain;
      if (!paint || !terrain) return false;
      paint(x, z, y, slope, terrain, out);
      return true;
    },
    layout,
  });
}
let field = pageField();
function reset(): void { field = pageField(); }
export function configureGrassField(next: grass.GrassFieldLayout, scope: Scope): void {
  meadowLayout(); layout = next; reset();
  scope.onDispose(() => { if (layout === next) { layout = null; reset(); } });
}
/** Admit the native meadow's geography on the page without author samplers. */
export function configureGrassFieldData(input:unknown,scope:Scope):grass.GrassFieldLayout{
  const next=populationMeadow(parse(PopulationFieldSchema,input));configureGrassField(next,scope);return next;
}
/** Page and native fields share the admitted meadow and exact clamped river
 * interpolation. This borrows the rows without decoding or installing a field. */
export function populationMeadow(rows:Pick<InferOutput<typeof PopulationFieldSchema>,'river'|'meadow'>):grass.GrassFieldLayout{
  const river=rows.river;
  const profile=(x:number,index:0|1):number=>{
    const at=Math.max(0,Math.min(river.values.length-1,(x-river.from)/river.step)),i=Math.min(river.values.length-2,Math.floor(at));
    const a=river.values[i]?.[index]??0,b=river.values[i+1]?.[index]??a;return a+(b-a)*(at-i);
  };
  return {...rows.meadow,riverZ:(x:number)=>profile(x,0),riverHalf:(x:number)=>profile(x,1)};
}
let listening = false;
function meadowLayout(): grass.GrassFieldLayout | null {
  if (!listening) { listening = true; onLevelChange(() => { layout = null; reset(); }); }
  return layout;
}
/** the page field, the level-change listener installed on first use (as the field always has) */
function page(): GrassField { meadowLayout(); return field; }

/**
 * Grass height before trampling, metres (0 = no grass), on the page's field (GrassField.baseHeightAt). `td` =
 * trailDistance(x, z) when the caller has it (pass Infinity far from any trail); `exact` also tests the splat at the point.
 */
export function grassBaseHeightAt(x: number, z: number, td: number = trailDistance(x, z), exact = false): number {
  return page().baseHeightAt(x, z, td, exact);
}

/** 0..1 flower-drift strength */
export function flowerPatchAt(x: number, z: number): number { return page().sample(x, z, 2); }
