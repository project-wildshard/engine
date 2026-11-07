import type { Color, Texture, Vector4 } from 'three';

/**
 * The fog-patch registry (01 §13.2, 10 §X5). The fog chunks (`fog_pars_*`, `fog_*`) are whole-chunk writes on three's
 * ShaderChunk, so the order they land in is the look. Every writer installs through `installFogPatch` with its slot:
 * the engine's fog 100 (Atmosphere), a level's stylize 200, a level's own fog 300 (`LookStrategy.fog.order`). A patch
 * installs once per page (by id). A new id at or below the last installed slot in its stage throws before changing the registry
 * or shader chunks: otherwise the result would be the call order, not the slot's (E357 L11 / B72).
 */
export const FOG_SLOT = { engine: 100, stylize: 200, level: 300 } as const;

/**
 * A painted world's panorama fog (G478 painterly look host): the haze takes the colour of the painting straight behind
 * each fragment, read from a heading LUT and re-tinted live by the hour and the weather, so the 3D world dissolves into its
 * painted sky with no step at any angle. Every value is a borrowed live uniform; its owner writes them, no shader rebuilds.
 */
export interface FogPanorama {
  /** 256 × 1 heading LUT, scene linear, repeating on the azimuth (atan(−x, z) / 2π) */
  readonly lut: { readonly value: Texture };
  /** x density (1/m), y clear distance (m), z the floor height the haze thins above (m), w the day's own distance density
   *  (the engine's fogDistDensity above it thickens the haze: a storm closes in) */
  readonly aerial: { readonly value: Vector4 };
  /** the world's edge dissolving into the same haze: x strength, y / z start / full (m from the centre, the larger of
   *  |x| |z|), w the view distance it needs (ground near the eye stays clear) */
  readonly edge: { readonly value: Vector4 };
  /** the live re-grade of the LUT: × key, a cool monochrome by moon, × light, into veilColour by veil, + flash */
  readonly tint: {
    readonly key: { readonly value: Color }; readonly moon: { readonly value: number }; readonly light: { readonly value: Color };
    readonly veil: { readonly value: number }; readonly veilColour: { readonly value: Color }; readonly flash: { readonly value: number };
  };
}
/** A fog patch's installed slot. */
export interface FogPatchEntry { id: string; order: number }

/** one page's fog patches: the page has one (installFogPatch); a test builds its own (E422) */
export class FogPatchRegistry {
  private readonly installed: FogPatchEntry[] = [];
  private readonly lastByStage = new Map<string | undefined, FogPatchEntry>();
  /** Run once per id; enforce slot order in the engine stage (omitted) or the supplied level stage. */
  install(id: string, order: number, install: () => void, stage?: string): boolean {
    if (this.installed.some((p) => p.id === id)) return false;
    const last = this.lastByStage.get(stage);
    if (last !== undefined && order <= last.order) throw new Error(`[fog] patch ${id} (slot ${order}) installs after ${last.id} (slot ${last.order})`);
    install();
    const entry: FogPatchEntry = { id, order };
    this.installed.push(entry);
    this.lastByStage.set(stage, entry);
    return true;
  }
  /** the installed fog patches, in install order (the WebGPU port inventory, tests) */
  patches(): readonly FogPatchEntry[] { return this.installed; }
}
const page = new FogPatchRegistry();

/** Run once per id; enforce slot order in the engine stage (omitted) or the supplied level stage. */
export function installFogPatch(id: string, order: number, install: () => void, stage?: string): boolean { return page.install(id, order, install, stage); }
