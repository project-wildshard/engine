import type { Renderer } from '../../client/engine/render/renderer';
import { installTextureUploadEvents } from '../../client/engine/render/textureUploadEvents';
import { legacyDouble } from './FakeGame';

/** Native-version fixture: callbacks run before the completed texture/source
 * rows publish, and the real upload observer decides whether release is safe. */
export function textureUploadRenderer(): Renderer {
  const rows = new WeakMap<object, Record<string, unknown>>();
  const get = (object: unknown): Record<string, unknown> => {
    if (typeof object !== 'object' || object === null) throw new Error('Texture property object required');
    let row = rows.get(object);
    if (row === undefined) { row = {}; rows.set(object, row); }
    return row;
  };
  const renderer = legacyDouble<Renderer>({
    getContext: () => legacyDouble<WebGL2RenderingContext>({}),
    properties: {
      has: object => typeof object === 'object' && object !== null && rows.has(object), get,
      remove: object => { if (typeof object === 'object' && object !== null) rows.delete(object); },
      update: (object, key, value: unknown) => { if (typeof key !== 'string') throw new Error('Texture property key required'); get(object)[key] = value; },
      dispose: () => undefined,
    },
    render: () => undefined, renderBufferDirect: () => undefined,
    initTexture: texture => {
      renderer.properties.get(texture);
      const version = texture.version, sourceVersion = texture.source.version;
      if (get(texture)['__version'] === version && get(texture.source)['__version'] === sourceVersion) return;
      texture.onUpdate?.(texture);
      get(texture)['__version'] = version; get(texture.source)['__version'] = sourceVersion;
    },
  });
  installTextureUploadEvents(renderer);
  return renderer;
}
