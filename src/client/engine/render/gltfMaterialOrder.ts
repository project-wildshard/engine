import { Material } from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RenderItem } from 'three/src/renderers/webgl/WebGLRenderLists.js';

interface MaterialOrder { readonly batch: number; readonly index?: number }
const orders = new WeakMap<Material, MaterialOrder>();
const configured = new WeakSet<GLTFLoader>();
let copying = false;

function nativeId(material: Material): number {
  const id: unknown = Reflect.get(material, 'id');
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('Missing native material identity');
  return id;
}
function materialOrder(material: Material): MaterialOrder {
  let order = orders.get(material);
  if (order === undefined) { order = { batch: nativeId(material) }; orders.set(material, order); }
  return order;
}

/** Copy private sort identity with native material clones, without adding fields
 * to userData, serialized assets, resource IDs or program cache keys. */
function installCopyOrder(): void {
  if (copying) return;
  copying = true;
  // oxlint-disable-next-line typescript/unbound-method -- Forward the native method with its actual receiver below.
  const nativeCopy = Material.prototype.copy;
  Material.prototype.copy = function copy(this: Material, source: Material): Material {
    const result = nativeCopy.call(this, source), order = orders.get(source);
    if (order?.index === undefined) orders.delete(this); else orders.set(this, order);
    return result;
  };
}

/** Reserve one native ID before any texture awaits. A file's opaque materials
 * then sort by glTF declaration index, not asynchronous texture completion.
 * The reservation is CPU-only; no renderer ever sees the empty material. */
export function installGltfMaterialOrder(loader: GLTFLoader): void {
  if (configured.has(loader)) return;
  configured.add(loader);
  installCopyOrder();
  loader.register(parser => {
    const batch = nativeId(new Material());
    const loadMaterial = parser.loadMaterial.bind(parser);
    parser.loadMaterial = async index => {
      const material = await loadMaterial(index);
      orders.set(material, { batch, index });
      return material;
    };
    return {
      name: 'declared-material-order',
      afterRoot: () => {
        for (const [resource, reference] of parser.associations) {
          const index = reference?.materials;
          if (resource instanceof Material && index !== undefined) orders.set(resource, { batch, index });
        }
        return null;
      },
    };
  });
}

/** Three's opaque sort, with private declaration identity in the material slot.
 * Unparsed materials retain native IDs. Transparent sorting remains native. */
export function gltfOpaqueSort(a: RenderItem, b: RenderItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const first = materialOrder(a.material), second = materialOrder(b.material);
  const batch = first.batch - second.batch;
  if (batch !== 0) return batch;
  const index = (first.index ?? 0) - (second.index ?? 0);
  if (index !== 0) return index;
  if (a.materialVariant !== b.materialVariant) return a.materialVariant - b.materialVariant;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}
