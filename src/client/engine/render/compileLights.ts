import { DirectionalLight, PointLight, Scene, SpotLight, type Light, type Object3D } from 'three';

type ShadowLight = DirectionalLight | PointLight | SpotLight;
const shadowLight = (light: Light): light is ShadowLight => light instanceof DirectionalLight || light instanceof PointLight || light instanceof SpotLight;
interface Copy { readonly source: ShadowLight; readonly light: ShadowLight; borrowed: ShadowLight['shadow']['map'] }

/** Warm-up-only lights preserve the future program's light counts. Borrow an
 * existing shadow without redrawing it; a missing map may be built privately.
 * The warm owns those private maps, never the source light or its attachments. */
const sources = new WeakMap<Light, Light>();
/** The page light a warm-up copy stands for (undefined: not a copy). A node (TSL) program keyed its lights by each
 *  light's id and bound its uniforms to that light, so a copy's own id keyed a program no real draw asked for: the node
 *  back-end (retired in NF18) built node programs with the sources; classic programs key only light counts. */
export function compileLightSource(light: Light): Light | undefined { return sources.get(light); }

const sceneSources = new WeakMap<Object3D, WeakRef<Scene>>();
/** Detached exterior compilation stands for this page scene. The alias owns
 * no page resources; callers still configure its exact fog, environment and
 * source lights. A retained compile target never keeps the page alive. */
export function createCompileScene(source: Scene): Scene {
  const scene = new Scene();
  sceneSources.set(scene, new WeakRef(source));
  return scene;
}
/** Identity only: matching the scene never substitutes for matching its live
 * fog, environment and source lights. Real unrelated scenes stay distinct. */
export function compileSceneSource(scene: Object3D): Object3D {
  return sceneSources.get(scene)?.deref() ?? scene;
}

export class CompileLights {
  private readonly copies: Copy[] = [];
  /** One copy per source light (G808: a shared set re-parents into each job's root instead of cloning per job) */
  private readonly made = new Map<Light, Light>();

  copy(source: Light): Light {
    const made = this.made.get(source);
    if (made !== undefined) return made;
    const light = source.clone(false);
    sources.set(light, source); this.made.set(source, light);
    if (shadowLight(source) && shadowLight(light)) this.copies.push({ source, light, borrowed: null });
    return light;
  }

  /** Refresh before each synchronous compile: another painted slice may have
   * resized the page's maps. Suppress writes only on the borrowed shadow. */
  prepare(): void {
    for (const copy of this.copies) {
      const { source, light, borrowed } = copy, map = source.shadow.map;
      if (map !== null) {
        if (light.shadow.map !== null && light.shadow.map !== borrowed) light.shadow.dispose();
        light.shadow.map = map;
        light.shadow.mapPass = null;
        copy.borrowed = map;
      } else if (borrowed !== null) {
        light.shadow.map = null;
        copy.borrowed = null;
      }
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = light.shadow.map === null;
    }
  }

  /** Always settle after compile/link/upload, including a cancellation. A
   * borrowed depth texture remains owned and usable by the actual light. */
  dispose(): void {
    for (const { light, borrowed } of this.copies) {
      if (light.shadow.map === borrowed) light.shadow.map = null;
      light.dispose();
      light.removeFromParent();
    }
    for (const light of this.made.values()) light.removeFromParent();
    this.copies.length = 0; this.made.clear();
  }
}
