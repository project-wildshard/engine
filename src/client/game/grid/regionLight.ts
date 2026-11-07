/**
 * A live region's light on the page's one sky (SHARD-PLATFORM G223 / SF48-g, E435). There is one sun, one fill, one
 * sky rig, one set of fog and painterly uniforms and one colour chain on a grid page (SF19a). A trusted runtime admitted
 * as a neighbour region lights them the way it lights its own standalone page: its day clock, weather and look rig write
 * the key light, the fill, the sun disc, the shadow maps, the painterly and fog uniforms, the volumetric light and the
 * engine grade every frame, and a few of those once at build.
 *
 * Honest per value:
 * - **its air and grade** already reach the one frame through `frameLook.ts` (its own fog object, its level's grade);
 * - **everything else it lights** is a region-scoped override of the shared state: held when the region is entered, put
 *   back exactly when it is left (so the road, or the next cell, finds the page as it was), and the region's own values
 *   come back on its next entry (its once-at-build writes, such as a phone shadow map size, survive the round trip).
 *   The override swaps at the interior crossing; it is not blended across the 16 m edge band (only the air and grade are).
 *
 * The painterly clock `uPTime` is a clock, not a look, and keeps running. Generic game code (E405): no shard is named here.
 */
import { Color, Vector3, type Vector4 } from 'three';
import { fogUniforms, weatherFogUniforms, weatherUniforms } from '@wildshard/engine/world/Atmosphere';
import { painterlyUniforms } from '@wildshard/engine/world/painterly';
import { wind } from '@wildshard/engine/world/steppeWind';
import type { AtmosphereSpec, SkySpec } from '@wildshard/engine/level/data';
import type { ShardWorld } from '../../../server/game/shard/world';

type UniformValue = number | Color | Vector3 | Vector4;
type UniformSet = Readonly<Record<string, { value: UniformValue }>>;

/** Hold every value of a shared uniform set (bar `skip`); the returned function puts each back in place. */
export function holdUniforms(set: UniformSet, skip: readonly string[] = []): () => void {
  const held: (() => void)[] = [];
  for (const [key, uniform] of Object.entries(set)) {
    if (skip.includes(key)) continue;
    const value = uniform.value;
    if (typeof value === 'number') held.push(() => { uniform.value = value; });
    else if (value instanceof Color) { const copy = value.clone(); held.push(() => { value.copy(copy); }); }
    else if (value instanceof Vector3) { const copy = value.clone(); held.push(() => { value.copy(copy); }); }
    else { const copy = value.clone(); held.push(() => { value.copy(copy); }); }
  }
  return () => { for (const restore of held) restore(); };
}

/** What a page's shared light is read from: its sky rig and its composer's grade chain (null before it is built). */
export interface PageLight {
  readonly sky: Pick<ShardWorld['sky'], 'holdLight'>;
  readonly game: Pick<ShardWorld['game'], 'post' | 'volumetrics'>;
}

/**
 * Hold the page's whole shared light: the sky rig's light (`SkyRig.holdLight`), the painterly uniforms (bar their clock),
 * the fog, weather and weather-fog uniforms, the engine grade (split tone, saturation, contrast, brightness) and the
 * volumetric light (built with the grade), and the one engine wind (a region's storm sets its speed, heading and gusts;
 * `Wind.hold`, its clocks keep running). The returned function puts it all back.
 */
export function holdPageLight(page: PageLight): () => void {
  const held = [page.sky.holdLight(), holdUniforms(painterlyUniforms, ['uPTime']), holdUniforms(fogUniforms), holdUniforms(weatherUniforms), holdUniforms(weatherFogUniforms), wind.hold()];
  const post = page.game.post;
  if (post !== null) {
    const saturation = post.saturation.saturation, contrast = post.contrast.contrast, brightness = post.contrast.brightness;
    held.push(post.grade.hold(), page.game.volumetrics.holdLight(), () => {
      post.saturation.saturation = saturation; post.contrast.contrast = contrast; post.contrast.brightness = brightness;
    });
  }
  return () => { for (const restore of held.reverse()) restore(); };
}

/** What a region's level look is written onto: the page's sky rig light parts and the region's own scene. */
export interface LevelLightTarget {
  readonly sky: { readonly sunColor: Color; readonly csm: { readonly lights: readonly { readonly color: Color; intensity: number }[] }; readonly hemi: { readonly color: Color; readonly groundColor: Color; intensity: number } };
  readonly scene: { environmentIntensity: number };
}

/**
 * Light the shared sky as the region's own level declares it, the way a standalone page's `SkyRig.build` and atmosphere
 * start it: the key light's colour and intensity, the hemisphere fill, the environment intensity (on the region's own scene)
 * and the fog uniforms (sun tint, height and distance densities). A region's runtime that reads its "day" off the live
 * light as it builds (Nalati's sky rig) then reads its own level, never the road's (G222 / G223 follow-up). The region's
 * fog colour stays its own fog object's (frameLook.ts), which its runtime's weather writes.
 */
export function applyLevelLight(target: LevelLightTarget, level: { readonly sky: SkySpec; readonly atmosphere: AtmosphereSpec }): void {
  const { sky: S, atmosphere: A } = level, sky = target.sky;
  sky.sunColor.setRGB(...S.sunColor);
  for (const light of sky.csm.lights) { light.color.copy(sky.sunColor); light.intensity = S.sunIntensity; }
  sky.hemi.color.set(S.hemiSky); sky.hemi.groundColor.set(S.hemiGround); sky.hemi.intensity = S.hemiIntensity;
  target.scene.environmentIntensity = S.envIntensity;
  fogUniforms.fogSunColor.value.setRGB(...S.fogSunColor);
  fogUniforms.fogHeight.value = A.fogHeight; fogUniforms.fogHeightFalloff.value = A.fogHeightFalloff;
  fogUniforms.fogHeightDensity.value = A.fogHeightDensity; fogUniforms.fogDistDensity.value = A.fogDistDensity;
}

/**
 * One region's light swap, for each entry: hold the page's light, put the region's own last light back, and on leave hold
 * the region's light for next time and put the page's back. On the first entry there is no region light yet: `first` (the
 * region's level look, `applyLevelLight`) lights the page as the region's level declares it, then its runtime lights it
 * further as it builds. `hold` reads the shared state (`holdPageLight` in the browser).
 */
export function regionLightSwap(hold: () => () => void, first?: () => void): (entry: { readonly onDispose: (fn: () => void) => void }) => void {
  let region: (() => void) | null = null;
  return (entry) => {
    const page = hold();
    if (region === null) first?.(); else region();
    entry.onDispose(() => { region = hold(); page(); });
  };
}
