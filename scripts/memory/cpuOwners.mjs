// Harness-only weak allocation identities. This diagnostic is never part of the game or the native A/B ruler.
export const CPU_INIT = `(() => {
  const rows = [], seen = new WeakSet();
  window.__g227CpuOwners = rows;
  const record = (object, kind) => {
    if (seen.has(object)) return;
    seen.add(object);
    rows.push({ kind, object: new WeakRef(object), stack: new Error().stack });
  };
  const Original = Float32Array;
  window.Float32Array = new Proxy(Original, { construct(target, args, newTarget) {
    const result = Reflect.construct(target, args, newTarget);
    if (result.byteLength >= 65536) record(result, 'Float32Array');
    return result;
  } });
  for (const Constructor of [window.HTMLCanvasElement, window.OffscreenCanvas]) {
    if (!Constructor) continue;
    const get = Constructor.prototype.getContext;
    Constructor.prototype.getContext = function(...args) {
      const result = Reflect.apply(get, this, args);
      if (result && args[0] === '2d') record(result, 'CanvasRenderingContext2D');
      return result;
    };
  }
})();`;

// Direct data descriptors avoid restoring Memory saver's released geometry arrays.
export const cpuOwnersExpression = `(() => {
  const api = window.__wildshard, rows = window.__g227CpuOwners ?? [], uses = new Map();
  const add = (object, owner) => { if (!object) return; const list = uses.get(object) ?? []; list.push(owner); uses.set(object, list); };
  api?.world?.game?.rootScene?.traverse(object => {
    const path = []; for (let node = object; node; node = node.parent) path.unshift(node.name || node.type);
    for (const [name, attribute] of Object.entries(object.geometry?.attributes ?? {})) {
      const storage = Object.getOwnPropertyDescriptor(attribute, 'data')?.value ?? attribute;
      add(Object.getOwnPropertyDescriptor(storage, 'array')?.value, path.join('/') + ':' + name);
    }
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      for (const value of [...Object.values(material), ...Object.values(material.uniforms ?? {}).map(u => u?.value)].flat()) {
        if (value?.isTexture) add(value.source?.data, path.join('/') + ':texture:' + (value.name || value.uuid));
      }
    }
  });
  return rows.flatMap((row, ordinal) => {
    const object = row.object.deref(); if (!object) return [];
    const canvas = object.canvas;
    return [{ ordinal, kind: row.kind, bytes: object.byteLength ?? canvas.width * canvas.height * 4,
      width: canvas?.width, height: canvas?.height, connected: canvas?.isConnected,
      dom: canvas?.outerHTML?.slice(0, 500), owners: uses.get(canvas ?? object) ?? [], stack: row.stack }];
  });
})()`;
