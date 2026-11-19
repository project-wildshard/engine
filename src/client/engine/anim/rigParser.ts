import type { LoadingManager } from 'three';
import { GLTFLoader, type GLTF, type GLTFLoaderPlugin, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { installGltfKtx2 } from '../core/ktx2';
import { pageScope } from '../../../shared/engine/app/resources';
import { waitFor } from '../../../shared/engine/boot/waits';
import { buildYield, WORK_SLICE_MS, workSlice, type WorkSlice } from '../../../shared/engine/core/workSlice';
import { buildHeld, buildUrgent, frameBudgetSpent, frameDue, presenting } from '../../../shared/engine/core/framePacing';

// FileLoader starts every network read immediately. Only the parser's temporary
// meshopt/image/geometry allocations share this page-wide decode slot.
let decodeTail: Promise<void> = Promise.resolve();
let decodeSlice: WorkSlice | undefined;
/** The shared loader defers immutable bytes until its decode slot. GLBs lend their
 * wire bytes: each buffer view is sliced from them in place (`splitGlb`). */
export interface RigLoader extends GLTFLoader {
  parseBytesAsync: (bytes: Uint8Array, path: string) => Promise<GLTF>;
}
/** A GLB whose BIN chunk is read where it lies in the file (`glbInPlace`), keyed by the JSON object the parser gets */
interface GlbBody { readonly bytes: ArrayBuffer; readonly offset: number; readonly length: number }
const GLB_BODIES = new WeakMap<object, GlbBody>();
const GLB_MAGIC = 0x46546c67, GLB_JSON = 0x4e4f534a, GLB_BIN = 0x004e4942;
const glbText = new TextDecoder();
/**
 * MEMORY-GATES MG10 (mini-ninemem): three's GLB reader copies the whole BIN chunk (`GLTFBinaryExtension`'s
 * `data.slice`) and then copies each buffer view out of that copy, so every GLB held its bytes three times while it
 * decoded (Nine's phone boot: 47 body copies, 61 MB of garbage under the loading card). Here a version-2 GLB with one
 * JSON and one BIN chunk is split by hand: the parser gets the JSON object and `glbInPlace` slices each buffer view straight
 * from the file's bytes. Anything else (a .gltf, a malformed GLB) goes to three as it was. `view` may be part of a larger
 * buffer (`parseBytesAsync`), so a lent view is no longer copied whole first either.
 */
function splitGlb(view: Uint8Array): object | null {
  const bytes = view.buffer;
  if (!(bytes instanceof ArrayBuffer) || view.byteLength < 28) return null;
  const header = new DataView(bytes, view.byteOffset, view.byteLength);
  if (header.getUint32(0, true) !== GLB_MAGIC || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== view.byteLength) return null;
  const jsonLength = header.getUint32(12, true);
  if (header.getUint32(16, true) !== GLB_JSON || 20 + jsonLength > view.byteLength) return null;
  let json: unknown;
  try { json = JSON.parse(glbText.decode(view.subarray(20, 20 + jsonLength))); } catch { return null; }
  if (typeof json !== 'object' || json === null) return null;
  const binAt = 20 + jsonLength;
  if (binAt === view.byteLength) return json; // no BIN chunk: nothing to lend
  if (binAt + 8 > view.byteLength || header.getUint32(binAt + 4, true) !== GLB_BIN) return null;
  const length = header.getUint32(binAt, true);
  if (binAt + 8 + length > view.byteLength) return null;
  const offset = view.byteOffset + binAt + 8;
  // a meshopt view reads buffer 0 itself at its own offset: that offset moves to the file's bytes, which buffer 0 now is
  const views: unknown = Reflect.get(json, 'bufferViews');
  if (Array.isArray(views)) for (const def of views) {
    const ext: unknown = typeof def === 'object' && def !== null ? Reflect.get(Reflect.get(def, 'extensions') ?? {}, 'EXT_meshopt_compression') : undefined;
    if (typeof ext !== 'object' || ext === null || Reflect.get(ext, 'buffer') !== 0) continue;
    const at: unknown = Reflect.get(ext, 'byteOffset') ?? 0;
    if (typeof at === 'number') Reflect.set(ext, 'byteOffset', at + offset);
  }
  GLB_BODIES.set(json, { bytes, offset, length });
  return json;
}
/** the parser half of `splitGlb`: buffer 0's views are sliced from the file, and buffer 0 itself is the file's bytes
 *  (only a meshopt view reads it, at the offset `splitGlb` moved; every plain view of buffer 0 is answered here first) */
function glbInPlace(parser: GLTFParser): GLTFLoaderPlugin {
  const body = GLB_BODIES.get(parser.json as object);
  const embedded = (index: number): boolean => {
    const buffers: unknown = Reflect.get(parser.json as object, 'buffers');
    return body !== undefined && index === 0 && Array.isArray(buffers) && typeof buffers[0] === 'object' && buffers[0] !== null && Reflect.get(buffers[0] as object, 'uri') === undefined;
  };
  if (body !== undefined) {
    const own = parser.loadBuffer.bind(parser);
    parser.loadBuffer = (index: number): Promise<ArrayBuffer> => embedded(index) ? Promise.resolve(body.bytes) : own(index);
  }
  return {
    name: 'WS_glb_in_place',
    loadBufferView: (index: number): Promise<ArrayBuffer> | null => {
      const views: unknown = Reflect.get(parser.json as object, 'bufferViews');
      const def: unknown = Array.isArray(views) ? views[index] : undefined;
      if (body === undefined || typeof def !== 'object' || def === null) return null;
      const buffer: unknown = Reflect.get(def, 'buffer'), at: unknown = Reflect.get(def, 'byteOffset') ?? 0, length: unknown = Reflect.get(def, 'byteLength') ?? 0;
      if (typeof buffer !== 'number' || !embedded(buffer) || typeof at !== 'number' || typeof length !== 'number' || at < 0 || at + length > body.length) return null;
      return Promise.resolve(body.bytes.slice(body.offset + at, body.offset + at + length));
    },
  };
}
/** what the parser is handed: three's own input, or a split GLB's JSON object (GLTFLoader.parse reads an object as the
 *  parsed JSON; its typings name only string and ArrayBuffer) */
type GltfSource = Parameters<GLTFLoader['parse']>[0] | object;
const asGlb = (data: Parameters<GLTFLoader['parse']>[0]): GltfSource => data instanceof ArrayBuffer ? (splitGlb(new Uint8Array(data)) ?? data) : data;

class BoundedRigLoader extends GLTFLoader implements RigLoader {
  constructor(manager?: LoadingManager) { super(manager); this.register(glbInPlace); }
  override parse(...[data, path, onLoad, onError]: Parameters<GLTFLoader['parse']>): void {
    this.parseSource(() => asGlb(data), path, onLoad, onError);
  }
  parseBytesAsync(bytes: Uint8Array, path: string): Promise<GLTF> {
    return new Promise((resolve, reject) => { this.parseSource(() => splitGlb(bytes) ?? Uint8Array.from(bytes).buffer, path, resolve, reject); });
  }
  private parseSource(read: () => GltfSource, path: string, onLoad: (file: GLTF) => void, onError?: Parameters<GLTFLoader['parse']>[3]): void {
    const parsed = decodeTail.then(async () => {
      // Cached CPU-only models otherwise chain every parse in microtasks. Let
      // uploads/frames and temporary-buffer retirement run between spent slices.
      if (typeof window !== 'undefined') {
        // The previous read/consumer can span drawn frames. Its wall clock
        // cannot charge that wait to this parse's current live CPU budget.
        const pause = presenting()
          ? (buildHeld() || buildUrgent() || !frameDue()) && !frameBudgetSpent(WORK_SLICE_MS) ? undefined : buildYield(pageScope)
          : (decodeSlice ??= workSlice(undefined, pageScope)).check();
        await waitFor('GLTF decode pacing', Promise.resolve(pause), 'work');
      }
      // Observe only active work: queued callers must not crowd this owner out
      // of the grid's bounded oldest-wait snapshot. Keep the original serial tail.
      // TEMPLATE-E2E TB-4b: the parse starts a microtask after the wait opens, so the wait's span holds the parse's
      // synchronous part (the GLB split and its JSON, most of a small model's decode), not only what it awaits after
      const decode = async (): Promise<GLTF> => {
        await Promise.resolve();
        return new Promise<GLTF>((resolve, reject) => { super.parse(read() as Parameters<GLTFLoader['parse']>[0], path, resolve, reject); });
      };
      return waitFor(`GLTF decode ${path || '(owned bytes)'}`, decode(), 'work');
    });
    // A failed file must release the slot as well as a successful one. Keep no
    // decoded scene in the tail after handing it to its existing resource owner.
    decodeTail = parsed.then(() => undefined, () => undefined);
    void parsed.then(onLoad, onError ?? ((error: unknown) => { console.error(error); }));
  }
}

/** One native parser policy for rigs, model pools and owned geometry. Reads stay
 * parallel; a page decodes one GLTF at a time, including direct parseAsync calls. */
export function createRigLoader(manager?: LoadingManager): RigLoader { installGltfKtx2(GLTFLoader); return new BoundedRigLoader(manager).setMeshoptDecoder(MeshoptDecoder); }
