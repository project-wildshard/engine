import type { DataTexture, DataTextureImageData, TextureSource } from 'three';
import type { SetName } from './viewmodelTextures';

interface Textures { map: DataTexture; normalMap: DataTexture; armMap: DataTexture | null }
type Source = TextureSource<DataTextureImageData>;
interface Sources { col: WeakRef<Source>; nrm: WeakRef<Source>; arm: WeakRef<Source> | null }

/** Bounded named procedural sets: live textures own their immutable pixels, the memo owns only weak sources.
 * Every consumer gets independent sampler/transform state. Keeping source pixels permits late clones. */
export class ViewmodelSources {
  private readonly sources = new Map<SetName, Sources>();
  private readonly wrap: (source: Source, srgb: boolean) => DataTexture;
  constructor(wrap: (source: Source, srgb: boolean) => DataTexture) { this.wrap = wrap; }
  take(name: SetName, build: () => Textures): Textures {
    const cached = this.sources.get(name);
    const col = cached?.col.deref(), nrm = cached?.nrm.deref(), arm = cached?.arm?.deref();
    if (col && nrm && (cached?.arm === null || arm)) {
      return { map: this.wrap(col, true), normalMap: this.wrap(nrm, false), armMap: arm ? this.wrap(arm, false) : null };
    }
    const textures = build();
    this.sources.set(name, { col: new WeakRef(textures.map.source), nrm: new WeakRef(textures.normalMap.source),
      arm: textures.armMap === null ? null : new WeakRef(textures.armMap.source) });
    return textures;
  }
}
