import { BufferAttribute, BufferGeometry, Float16BufferAttribute, InterleavedBufferAttribute, type Mesh, type TypedArray } from 'three';
import * as v from 'valibot';
import { NativeAttributesSchema } from '@wildshard/format/nativeGeometryChannels';

const NO_WORDS = new Uint16Array(0);
/** MEMORY-GATES MG10: a half-float attribute over `words` itself. three's Float16BufferAttribute constructor copies its
 *  array (`new Uint16Array(array)`), so every half channel made from words already in hand cost a second buffer and left
 *  the first as garbage (Nine's slab merge and whole shapes: ~37 MB of dead copies at its loading peak). */
export function halfAttribute(words: Uint16Array, itemSize: number, normalized?: boolean): Float16BufferAttribute {
  const attribute = new Float16BufferAttribute(NO_WORDS, itemSize, normalized);
  attribute.array = words; Reflect.set(attribute, 'count', words.length / itemSize); // three types count read-only; its constructor sets it the same way
  return attribute;
}
const semantics: Readonly<Record<string, string>> = { POSITION: 'position', NORMAL: 'normal', COLOR_0: 'color', TEXCOORD_0: 'uv', TANGENT: 'tangent' };

/** iPhone downloads I3: a padded channel (a 16-bit grid position has an 8-byte stride) reads back interleaved; its stored
 *  values are copied out unchanged into a plain attribute of the same storage. */
function plainGeometryAttribute(attribute: InterleavedBufferAttribute): BufferAttribute {
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
  const result = new BufferAttribute(out, attribute.itemSize, attribute.normalized).setUsage(data.usage);
  result.name = attribute.name;
  return result;
}

function plain(attribute: unknown): unknown { return attribute instanceof InterleavedBufferAttribute ? plainGeometryAttribute(attribute) : attribute; }

/** Three uploads a GLB view once per scalar type if its channels use different typed views.
 * Keep the original channel values and scalar types, with only the bytes each channel reads. */
export function separateMixedChannels(geometry: BufferGeometry): void {
  const groups = new Map<ArrayBufferLike, [string, InterleavedBufferAttribute][]>();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (!(attribute instanceof InterleavedBufferAttribute)) continue;
    const backing = attribute.data.array.buffer, group = groups.get(backing) ?? [];
    group.push([name, attribute]); groups.set(backing, group);
  }
  for (const group of groups.values()) {
    const first = group[0]?.[1].data.array;
    if (first === undefined || new Set(group.map(([, attribute]) => attribute.data.array.constructor)).size < 2) continue;
    if (group.some(([, { data: { array } }]) => array.byteOffset !== first.byteOffset || array.byteLength !== first.byteLength)) continue;
    const packedBytes = group.reduce((sum, [, attribute]) => sum + attribute.count * attribute.itemSize * attribute.data.array.BYTES_PER_ELEMENT, 0);
    if (packedBytes > first.byteLength) continue;
    for (const [name, attribute] of group) geometry.setAttribute(name, plainGeometryAttribute(attribute));
  }
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
      // borrowed bits are copied (three's constructor copies), taken ones are wrapped where they lie
      result.setAttribute(name, ownership === 'take' ? halfAttribute(attribute.array, row.itemSize, row.normalized) : new Float16BufferAttribute(attribute.array, row.itemSize, row.normalized));
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
      geometry.setAttribute(name, halfAttribute(attribute.array, row.itemSize, row.normalized));
    } else {
      if (attribute.array.constructor.name !== row.storage) throw new Error('Native channel storage mismatch');
      geometry.setAttribute(name, attribute);
    }
    if (channel !== name) geometry.deleteAttribute(channel);
  }
}
