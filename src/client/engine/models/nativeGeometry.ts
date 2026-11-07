import { BufferAttribute, BufferGeometry, Float16BufferAttribute, InterleavedBufferAttribute, type Mesh, type TypedArray } from 'three';
import * as v from 'valibot';

/** Portable accessor metadata for one original typed application channel. */
export const NativeAttributeSchema: v.GenericSchema<BoundedNativeAttributeInput, BoundedNativeAttribute> = v.strictObject({ semantic: v.string(), storage: v.picklist(['Float32Array', 'Float16Array', 'Uint16Array', 'Uint32Array', 'Int16Array', 'Int8Array', 'Uint8Array']), normalized: v.boolean(), itemSize: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4)) });
/** Original application channel names mapped to their exact stored accessors. */
export const NativeAttributesSchema: v.GenericSchema<BoundedNativeAttributesInput, BoundedNativeAttributes> = v.record(v.string(), NativeAttributeSchema);
const semantics: Readonly<Record<string, string>> = { POSITION: 'position', NORMAL: 'normal', COLOR_0: 'color', TEXCOORD_0: 'uv', TANGENT: 'tangent' };

/** iPhone downloads I3: a padded channel (a 16-bit grid position has an 8-byte stride) reads back interleaved; its stored
 *  values are copied out unchanged into a plain attribute of the same storage. */
function plain(attribute: unknown): unknown {
  if (!(attribute instanceof InterleavedBufferAttribute)) return attribute;
  const data = attribute.data, source: TypedArray = data.array, out = new (source.constructor as new (length: number) => TypedArray)(attribute.count * attribute.itemSize);
  const size = attribute.itemSize, stride = data.stride;
  // Integer storage has no floating NaN conversion to preserve.
  if (stride === size && attribute.offset === 0 && !(source instanceof Float32Array) && !(source instanceof Float64Array)) out.set(source);
  else if (size >= 1 && size <= 4 && Number.isInteger(size)) {
    // Native channels have one to four words. Advance both cursors once per
    // vertex, rather than multiplying them again for every padded word.
    let target = 0, at = attribute.offset;
    for (let i = 0; i < attribute.count; i++, at += stride) {
      out[target++] = source[at] ?? 0;
      if (size > 1) out[target++] = source[at + 1] ?? 0;
      if (size > 2) out[target++] = source[at + 2] ?? 0;
      if (size > 3) out[target++] = source[at + 3] ?? 0;
    }
  } else for (let i = 0; i < attribute.count; i++) for (let c = 0; c < size; c++) out[i * size + c] = source[i * stride + attribute.offset + c] ?? 0;
  return new BufferAttribute(out, attribute.itemSize, attribute.normalized);
}

/** Restore original typed GLB channels, including half-float bits and vec4 shader normals.
 * Borrowed input is copied. An exclusively owned decoded mesh may transfer its
 * plain attributes/index; half-float restoration still creates its typed wrapper. */
export function nativeWholeGeometry(node: Mesh, ownership: 'borrow' | 'take' = 'borrow', preserveInterleaving = false): BufferGeometry {
  return admitNativeWholeGeometry(node, ownership, preserveInterleaving).geometry;
}

/** One admission and restoration, returning the detached channel snapshot used
 * to check the geometry. No caller-supplied schema proof or cross-call cache. */
export function admitNativeWholeGeometry(node: Mesh, ownership: 'borrow' | 'take' = 'borrow', preserveInterleaving = false): {
  readonly geometry: BufferGeometry; readonly channels: v.InferOutput<typeof NativeAttributesSchema>;
} {
  const metadata: unknown = node.userData['nativeAttributes'], input: unknown = node.geometry;
  if (!(input instanceof BufferGeometry)) throw new Error('Whole shape needs geometry');
  const channels = v.parse(NativeAttributesSchema, metadata), result = new BufferGeometry();
  for (const [name, row] of Object.entries(channels)) {
    const channel = semantics[row.semantic] ?? row.semantic.toLowerCase();
    const stored: unknown = input.getAttribute(channel);
    // An exclusive decoder can lend its stride directly to a final assembler.
    // Public borrowed copies and half-float wrappers keep the plain path.
    if (ownership === 'take' && preserveInterleaving && row.storage !== 'Float16Array' && stored instanceof InterleavedBufferAttribute) {
      if (stored.itemSize !== row.itemSize || stored.normalized !== row.normalized) throw new Error(`Whole shape missing typed channel ${channel}`);
      if (stored.data.array.constructor.name !== row.storage) throw new Error('Whole channel storage mismatch');
      result.setAttribute(name, stored); continue;
    }
    const attribute: unknown = plain(stored);
    if (!(attribute instanceof BufferAttribute) || attribute.itemSize !== row.itemSize || attribute.normalized !== row.normalized) throw new Error(`Whole shape missing typed channel ${channel}`);
    if (row.storage === 'Float16Array') {
      if (!(attribute.array instanceof Uint16Array)) throw new Error('Whole half-float channel needs uint16 bits');
      result.setAttribute(name, new Float16BufferAttribute(attribute.array, row.itemSize, row.normalized));
    } else {
      if (attribute.array.constructor.name !== row.storage) throw new Error('Whole channel storage mismatch');
      result.setAttribute(name, ownership === 'take' ? attribute : attribute.clone());
    }
  }
  const index = input.getIndex();
  result.setIndex(ownership === 'take' ? index : index?.clone() ?? null);
  return { geometry: result, channels };
}

/**
 * D154: a native node drawn as parsed keeps every portable channel, but one it stores only as its typed copy has no
 * attribute under the name three reads: a vec4 shader normal is never a glTF NORMAL (`sharddev/bake/glb.ts`), so a lit
 * material normalized a zero normal to NaN, which bloom spread into black blocks (Nine Dragon's L0 ring tiles seen from
 * Nalati). Each drawn channel the geometry lacks is restored under its own name from its stored accessor (the stored
 * copy goes, so nothing uploads twice). Custom application channels follow the same explicit metadata: glTF lowercases
 * `_AFACE` to `_aface`, while its original declared name can be `aFace`. Restore those names and exact typed storage
 * too, without inferring names from semantics. A node without native metadata is unchanged.
 */
export function restoreDrawnChannels(node: Mesh): void {
  const metadata: unknown = node.userData['nativeAttributes'], geometry: unknown = node.geometry;
  if (metadata === undefined || !(geometry instanceof BufferGeometry)) return;
  for (const [name, row] of Object.entries(v.parse(NativeAttributesSchema, metadata))) {
    if (geometry.hasAttribute(name)) continue;
    const channel = semantics[row.semantic] ?? row.semantic.toLowerCase(), attribute: unknown = plain(geometry.getAttribute(channel));
    if (!(attribute instanceof BufferAttribute) || attribute.itemSize !== row.itemSize || attribute.normalized !== row.normalized) throw new Error(`Native node missing typed channel ${channel}`);
    if (row.storage === 'Float16Array') {
      if (!(attribute.array instanceof Uint16Array)) throw new Error('Native half-float channel needs uint16 bits');
      geometry.setAttribute(name, new Float16BufferAttribute(attribute.array, row.itemSize, row.normalized));
    } else {
      if (attribute.array.constructor.name !== row.storage) throw new Error('Native channel storage mismatch');
      geometry.setAttribute(name, attribute);
    }
    if (channel !== name) geometry.deleteAttribute(channel);
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedNativeAttributeInput = BoundedNativeAttribute;
interface BoundedNativeAttributeFields {
    semantic: string;
    storage: "Float32Array" | "Float16Array" | "Uint16Array" | "Uint32Array" | "Int16Array" | "Int8Array" | "Uint8Array";
    normalized: boolean;
    itemSize: number;
}
type BoundedNativeAttribute = { [Key in keyof BoundedNativeAttributeFields]: BoundedNativeAttributeFields[Key] };
type BoundedNativeAttributesInput = BoundedNativeAttributes;
type BoundedNativeAttributes = Record<string, {
        semantic: string;
        storage: "Float32Array" | "Float16Array" | "Uint16Array" | "Uint32Array" | "Int16Array" | "Int8Array" | "Uint8Array";
        normalized: boolean;
        itemSize: number;
    }>;
