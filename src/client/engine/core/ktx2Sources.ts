import type { CompressedTexture } from 'three';

/** Cross-wave identity only: live textures own the source; this bounded memo owns no pixels or GL handles.
 * Each caller still supplies freshly transcoded mips, so a new sampler or a disposed upload can be rebuilt. */
export class Ktx2Sources {
  private readonly sources = new Map<string, WeakRef<CompressedTexture['source']>>();
  private readonly limit: number;
  constructor(limit = 256) { this.limit = limit; }

  share(texture: CompressedTexture, url: string, level: number): void {
    const key = JSON.stringify([url, level, texture.format, texture.type, texture.image.width, texture.image.height]);
    const source = this.sources.get(key)?.deref();
    this.sources.delete(key);
    if (source) texture.source = source;
    this.sources.set(key, new WeakRef(texture.source));
    while (this.sources.size > this.limit) {
      const oldest = this.sources.keys().next();
      if (oldest.done) break;
      this.sources.delete(oldest.value);
    }
  }
}
