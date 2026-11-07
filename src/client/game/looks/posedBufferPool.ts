import { DynamicDrawUsage, InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';

type Channels = readonly [string, string?];
/** GPU attributes use shared interleaved storage plus an offset. CPU arrays
 * are matching subarrays so ordinary InstancedMesh.getMatrixAt remains exact. */
export class PosedBufferView {
  readonly matrix: Float32Array;
  readonly first: Float32Array;
  readonly second: Float32Array | null;
  readonly matrixAttribute: InterleavedBufferAttribute;
  readonly firstAttribute: InterleavedBufferAttribute;
  readonly secondAttribute: InterleavedBufferAttribute | null;
  constructor(private readonly owner: Scope, matrix: InstancedInterleavedBuffer, first: InstancedInterleavedBuffer, second: InstancedInterleavedBuffer | null,
    start: number, capacity: number) {
    const secondArray = second?.array;
    if (!(matrix.array instanceof Float32Array) || !(first.array instanceof Float32Array) || secondArray !== undefined && !(secondArray instanceof Float32Array)) throw new Error('Posed buffer storage must be Float32');
    this.matrix = matrix.array.subarray(start * 16, (start + capacity) * 16);
    this.first = first.array.subarray(start * 4, (start + capacity) * 4);
    this.second = secondArray === undefined ? null : secondArray.subarray(start * 4, (start + capacity) * 4);
    this.matrixAttribute = new InterleavedBufferAttribute(matrix, 16, start * 16);
    this.firstAttribute = new InterleavedBufferAttribute(first, 4, start * 4);
    this.secondAttribute = second === null ? null : new InterleavedBufferAttribute(second, 4, start * 4);
  }
  /** Both ordinary update systems finish before rendering. Three consumes the
   * final shared version once, rather than uploading each view separately. */
  publish(): void {
    if (this.owner.disposed || this.owner.disposing) throw new Error('Posed buffer owner has ended');
    this.matrixAttribute.data.needsUpdate = true;
    this.firstAttribute.data.needsUpdate = true;
    if (this.secondAttribute !== null) this.secondAttribute.data.needsUpdate = true;
  }
}

/** Disjoint CPU views of one matrix/two-vec4 GPU upload. All views belong to
 * the same lifetime; draw objects, flags, layouts and counts remain separate. */
export class PosedBufferPool {
  private used = 0;
  private closed = false;
  private channels: Channels | undefined;
  private readonly matrix: InstancedInterleavedBuffer;
  private readonly first: InstancedInterleavedBuffer;
  private second: InstancedInterleavedBuffer | null = null;
  constructor(private readonly owner: Scope, readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 4096 || owner.disposed || owner.disposing) throw new Error('Invalid posed buffer owner or capacity');
    this.matrix = new InstancedInterleavedBuffer(new Float32Array(capacity * 16), 16).setUsage(DynamicDrawUsage);
    this.first = new InstancedInterleavedBuffer(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    owner.onDispose(() => { this.closed = true; });
  }
  get configured(): boolean { return this.channels !== undefined; }
  /** Sharing is opt-in only for equal attribute names; pose meanings stay per draw. */
  supports(channels: Channels): boolean {
    return !this.closed && !this.owner.disposed && !this.owner.disposing && channels[0] !== 'instanceMatrix' && channels[1] !== 'instanceMatrix'
      && (this.channels === undefined || channels[0] === this.channels[0] && channels[1] === this.channels[1]);
  }
  reserve(capacity: number, channels: Channels): PosedBufferView {
    if (this.closed || this.owner.disposed || this.owner.disposing || !Number.isSafeInteger(capacity) || capacity < 1 || this.used + capacity > this.capacity) throw new Error('Posed buffer range exceeds its live owner');
    if (!this.supports(channels) || channels[0] === channels[1]
      || channels.some(name => name !== undefined && !/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(name))) throw new Error('Incompatible posed buffer channels');
    if (this.channels === undefined) {
      this.channels = channels[1] === undefined ? [channels[0]] : [channels[0], channels[1]];
      if (channels[1] !== undefined) this.second = new InstancedInterleavedBuffer(new Float32Array(this.capacity * 4), 4).setUsage(DynamicDrawUsage);
    }
    const start = this.used; this.used += capacity;
    return new PosedBufferView(this.owner, this.matrix, this.first, this.second, start, capacity);
  }
}
