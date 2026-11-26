// ENGINE-MEMORY EM26 (design rule 7, one texture path on the phone): a browser-side recorder of shard textures uploaded
// as decoded RGBA. Installed as an init script (`context.addInitScript(recordImageUploads)`), it wraps WebGL's
// `texImage2D` and `texSubImage2D` and logs, to `globalThis.__imageUploads`, every level-0 upload whose source is a
// decoded image (an ImageBitmap or an <img>: a texture file, as opposed to a render target, a canvas or a data
// texture the engine generates) of more than IMAGE_UPLOAD_LIMIT_BYTES at four bytes a texel. A KTX2 texture uploads
// through `compressedTex*` and is never logged.

/** A decoded shard texture over this many RGBA8 bytes fails the phone check (EM26: "no shard texture as RGBA8 over 1 MB"). */
export const IMAGE_UPLOAD_LIMIT_BYTES = 1024 * 1024;

/** Browser-side: install the recorder. Self-contained (serialized by Playwright). */
export function recordImageUploads() {
  const limit = 1024 * 1024;
  /** @type {{width: number, height: number, bytes: number, src: string}[]} */
  const log = [];
  Reflect.set(globalThis, '__imageUploads', log);
  /** @param {unknown} value */
  const decoded = value => (typeof ImageBitmap === 'function' && value instanceof ImageBitmap)
    || (typeof HTMLImageElement === 'function' && value instanceof HTMLImageElement);
  /** @param {unknown[]} args */
  const note = args => {
    if (args[1] !== 0) return;
    const source = args.find(decoded);
    if (source === undefined) return;
    const width = Number(Reflect.get(/** @type {object} */ (source), 'width')), height = Number(Reflect.get(/** @type {object} */ (source), 'height'));
    const bytes = width * height * 4;
    if (bytes > limit) log.push({ width, height, bytes, src: String(Reflect.get(/** @type {object} */ (source), 'src') ?? '') });
  };
  /** @param {object} proto @param {string} name */
  const wrap = (proto, name) => {
    /** @type {(...args: unknown[]) => unknown} */
    const original = Reflect.get(proto, name);
    if (typeof original !== 'function') return;
    Reflect.set(proto, name, function upload(/** @type {unknown[]} */ ...args) {
      try { note(args); } catch { /* the recorder never changes the upload */ }
      return Reflect.apply(original, this, args);
    });
  };
  for (const name of ['WebGL2RenderingContext', 'WebGLRenderingContext']) {
    const context = Reflect.get(globalThis, name);
    if (typeof context !== 'function') continue;
    wrap(context.prototype, 'texImage2D');
    wrap(context.prototype, 'texSubImage2D');
  }
}
