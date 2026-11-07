import * as v from 'valibot';
import { unzlibSync } from 'fflate';
import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';
import { decodeScalarStorage,ScalarChannelSchema,ScalarLatticeSchema,type ScalarChannelRows,type ScalarLatticeRows } from '@wildshard/format/scalarChannel';

export function readScalarChannel(input: ScalarChannelRows & { readonly type: 'f32' },blocks?:ReadonlyMap<string,Uint8Array>): Float32Array;
export function readScalarChannel(input: ScalarChannelRows & { readonly type: 'f64' },blocks?:ReadonlyMap<string,Uint8Array>): Float64Array;
export function readScalarChannel(input: unknown,blocks?:ReadonlyMap<string,Uint8Array>): Float32Array | Float64Array;
/** One bounded inflate and one typed view, with no conversion, interpolation,
 * owner/cache or second intake. Reject short, oversized and non-finite rows. */
export function readScalarChannel(input: unknown,blocks?:ReadonlyMap<string,Uint8Array>): Float32Array | Float64Array {
  const row = v.parse(ScalarChannelSchema,input);
  if(typeof row.data==='string')throw new Error('Scalar channels require binary files');
  const source=blocks?.get(row.data.file);
  if(source===undefined)throw new Error('Missing scalar block');
  return decodeScalarStorage(row, source, (bytes, out) => unzlibSync(bytes, { out }));
}

/**
 * Each zlib block inflated by the platform's stream decoder, off the script's own work (in script where there is none),
 * for `ScalarLatticeBindings.prepare`: a cold Nalati / Nine Dragon crossing inflated its scalar blocks with fflate in one
 * task (~70 ms at phone 4× CPU). The bytes are exactly unzlibSync's.
 */
export async function inflateScalarBlocks(blocks: ReadonlyMap<string, Uint8Array>): Promise<Map<string, Uint8Array>> {
  const inflate = async (bytes: Uint8Array): Promise<Uint8Array> => {
    if (typeof DecompressionStream === 'undefined') return unzlibSync(bytes);
    const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  return new Map(await Promise.all([...blocks].map(async ([file, bytes]) => [file, await inflate(bytes)] as const)));
}

/** Decode once and borrow that same native typed storage for the defining bilinear sampler. */
export function readScalarLattice(input: unknown,blocks?:ReadonlyMap<string,Uint8Array>): (x: number,z: number) => number {
  const row = v.parse(ScalarLatticeSchema,input),values = readScalarChannel(row.values,blocks);
  if (!(values instanceof Float32Array)) throw new Error('Scalar lattice requires f32 storage');
  return bakedSamplers({ res: row.res,size: row.size,heights: values,seed: 0,landscapeHash: 0,splat: new Uint8Array(0),undergrowth: null }).heightAt;
}

type Sample = (x: number, z: number) => number;
interface LatticeBounds { readonly min: number; readonly max: number }
interface LatticeBinding {
  readonly row: ScalarLatticeRows;
  readonly bounds: LatticeBounds | undefined;
  sample: Sample | undefined;
  readonly read: Sample;
}
interface ChannelBinding {
  readonly row: ScalarChannelRows;
  values: Float32Array | Float64Array | undefined;
  readonly read: (index: number) => number;
}
function scalarValue(values: Float32Array | Float64Array, index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error('Scalar channel index outside declared count');
  return value;
}
/** One definition's declared binary rasters. Registration performs no IO or
 * inflate; preparation validates every block before publishing any sampler. */
export class ScalarLatticeBindings {
  private readonly bindings = new Map<string, LatticeBinding>();
  private readonly channels = new Map<string, ChannelBinding>();
  private ready = false;
  private sealed = false;
  get prepared(): boolean { return this.ready || this.bindings.size === 0 && this.channels.size === 0; }
  get files(): readonly string[] { return [...new Set([...this.bindings.keys(), ...this.channels.keys()])]; }
  seal(): void { this.sealed = true; }

  lattice(input: unknown, bounds?: LatticeBounds): Sample {
    const row = v.parse(ScalarLatticeSchema, input);
    if (typeof row.values.data === 'string') throw new Error('Scalar channels require binary files');
    const file = row.values.data.file, prior = this.bindings.get(file);
    const channel = this.channels.get(file);
    if (channel !== undefined && (channel.row.type !== row.values.type || channel.row.count !== row.values.count)) throw new Error('Conflicting scalar block declaration');
    if (prior !== undefined) {
      if (prior.row.res !== row.res || prior.row.size !== row.size || prior.row.values.count !== row.values.count
        || prior.row.values.type !== row.values.type || prior.bounds?.min !== bounds?.min || prior.bounds?.max !== bounds?.max) {
        throw new Error('Conflicting scalar block declaration');
      }
      return prior.read;
    }
    if (this.ready || this.sealed) throw new Error('Scalar declarations already sealed');
    if (this.files.length >= 64 && channel === undefined) throw new Error('Too many scalar blocks');
    const entry: LatticeBinding = {
      row, bounds: bounds === undefined ? undefined : { ...bounds }, sample: undefined,
      read: (x, z) => {
        if (entry.sample === undefined) throw new Error('Scalar blocks are not prepared');
        return entry.sample(x, z);
      },
    };
    this.bindings.set(file, entry);
    return entry.read;
  }

  /** Exact indexed scalars, including f64 candidate values; no sampler or resampling.
   * File-backed reads stay closed until every declared channel and lattice validates. */
  channel(input: unknown): (index: number) => number {
    const row = v.parse(ScalarChannelSchema, input);
    if (typeof row.data === 'string') throw new Error('Scalar channels require binary files');
    const file = row.data.file, prior = this.channels.get(file), lattice = this.bindings.get(file);
    if (lattice !== undefined && (lattice.row.values.type !== row.type || lattice.row.values.count !== row.count)) throw new Error('Conflicting scalar block declaration');
    if (prior !== undefined) {
      if (prior.row.type !== row.type || prior.row.count !== row.count) throw new Error('Conflicting scalar block declaration');
      return prior.read;
    }
    if (this.ready || this.sealed) throw new Error('Scalar declarations already sealed');
    if (this.files.length >= 64 && lattice === undefined) throw new Error('Too many scalar blocks');
    const entry: ChannelBinding = { row, values: undefined, read: index => {
      if (entry.values === undefined) throw new Error('Scalar blocks are not prepared');
      return scalarValue(entry.values, index);
    } };
    this.channels.set(file, entry);
    return entry.read;
  }

  /** `inflated`: the blocks already inflated (`inflateScalarBlocks`); a block it lacks is inflated here. */
  prepare(blocks: ReadonlyMap<string, Uint8Array>, inflated?: ReadonlyMap<string, Uint8Array>): void {
    if (this.ready) return;
    this.seal();
    const decoded = new Map<string, Float32Array | Float64Array>();
    const storage = (row: ScalarChannelRows): Float32Array | Float64Array => {
      if (typeof row.data === 'string') throw new Error('Scalar channels require binary files');
      const prior = decoded.get(row.data.file);
      if (prior !== undefined) return prior;
      const raw = inflated?.get(row.data.file);
      const values = raw === undefined ? readScalarChannel(row, blocks) : decodeScalarStorage(row, raw, source => source);
      decoded.set(row.data.file, values); return values;
    };
    const candidates = [...this.bindings.values()].map(entry => ({
      entry, sample: this.sample(entry.row, storage(entry.row.values), entry.bounds),
    }));
    const channels = [...this.channels.values()].map(entry => ({ entry, values: storage(entry.row) }));
    for (const { entry, sample } of candidates) entry.sample = sample;
    for (const { entry, values } of channels) entry.values = values;
    this.ready = true;
  }

  private sample(row: ScalarLatticeRows, values: Float32Array | Float64Array, bounds: LatticeBounds | undefined): Sample {
    if (!(values instanceof Float32Array)) throw new Error('Scalar lattice requires f32 storage');
    if (bounds !== undefined && !values.every(value => value >= bounds.min && value <= bounds.max)) {
      throw new Error('Scalar lattice outside declared bounds');
    }
    return bakedSamplers({ res: row.res, size: row.size, heights: values, seed: 0,
      landscapeHash: 0, splat: new Uint8Array(0), undergrowth: null }).heightAt;
  }
}
