/** S12d: the cook's ASTC 6×6 encoder with no child process: basisu's own WebAssembly build (`basisu/`, Binomial's
 * `webgl/encoder/build` at 32c7b74, Apache-2.0), so the box's cook job (`--permission`, no child processes, no basisu
 * installed) and CI's bake encode what `cook --phone-astc6` encoded with the CLI (S12c). Same steps and flags: the
 * trimmed master's top level decoded to RGBA, encoded as ASTC LDR 6×6 at effort 4 with the role's preset (`-srgb`,
 * `-linear`, `-normal_map`), zstd in a KTX2. The CLI took the master's own lower levels; this build regenerates them from
 * the top one. Probed on Pine's `wood_planks_dirt` at 1024: top level 66–71 dB from the CLI's, the same PSNR against the
 * master, sizes within 0.2% (colour, normal) and 5% (ARM).
 *
 * `encode` is synchronous, as `phoneTier` calls it. `record` and `flush` let a cook run the same encodes on worker
 * threads first: a recording pass collects every input, `flush` encodes them `lanes` at a time, and the real pass then
 * reads them back. A cache folder, when given, keeps encodes across cooks by input hash (C4); the box's job passes none,
 * because a cook job's files can't be trusted by the next one. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createRequire} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {availableParallelism} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {Worker} from 'node:worker_threads';
import type {Astc6Encode, TextureRole} from './tierTextures';

/** The vendored build; a new build is a new cache key. */
export const BASISU_WASM_BUILD = '32c7b74';
const KEY_PREFIX = `astc6-wasm/1|${BASISU_WASM_BUILD}|ASTC_LDR_6x6 effort 4|`;
const MAX_LANES = 6;

interface Ktx2File {
  readonly isValid: () => boolean; readonly startTranscoding: () => boolean; readonly getLevels: () => number; readonly close: () => void; readonly delete: () => void;
  readonly getImageLevelInfo: (level: number, layer: number, face: number) => {origWidth: number; origHeight: number};
  readonly getImageTranscodedSizeInBytes: (level: number, layer: number, face: number, format: number) => number;
  readonly transcodeImage: (out: Uint8Array, level: number, layer: number, face: number, format: number, alpha: number, channel0: number, channel1: number) => number;
}
interface BasisEncoder {
  readonly setCreateKTX2File: (on: boolean) => void; readonly setKTX2UASTCSupercompression: (on: boolean) => void; readonly setDebug: (on: boolean) => void; readonly setStatusOutput: (on: boolean) => void;
  readonly setSliceSourceImage: (slice: number, rgba: Uint8Array, width: number, height: number, type: number) => boolean;
  readonly setFormatMode: (format: number) => void; readonly setFormatModeAndQualityEffort: (format: number, quality: number, effort: number, defaults: boolean) => void;
  readonly setSRGBPreset: () => void; readonly setLinearPreset: () => void; readonly setNormalMapPreset: () => void; readonly setMipGen: (on: boolean) => void; readonly setMipSRGB: (on: boolean) => void;
  readonly encode: (out: Uint8Array) => number; readonly delete: () => void;
}
interface BasisModule {
  readonly initializeBasis: () => void;
  KTX2File: new (bytes: Uint8Array) => Ktx2File;
  BasisEncoder: new () => BasisEncoder;
  transcoder_texture_format: {cTFRGBA32: {value: number}};
  basis_tex_format: {cASTC_LDR_6x6: {value: number}};
  ldr_image_type: {cRGBA32: {value: number}};
}
type BasisFactory = (options: {wasmBinary: Uint8Array; print: () => void; printErr: () => void}) => Promise<BasisModule>;

const PRESET = {srgb: 'setSRGBPreset', linear: 'setLinearPreset', normal: 'setNormalMapPreset'} as const satisfies Record<TextureRole, keyof BasisEncoder>;

/** One encoder on this thread: the master's top level to RGBA, then ASTC 6×6. Undefined when basisu refuses the file. */
export async function loadBasisuAstc6(): Promise<Astc6Encode> {
  const require = createRequire(import.meta.url);
  const factory = require('./basisu/basis_encoder.cjs') as BasisFactory;
  const wasm = new Uint8Array(readFileSync(new URL('basisu/basis_encoder.wasm', import.meta.url)));
  const basis = await factory({wasmBinary: wasm, print: () => undefined, printErr: () => undefined});
  basis.initializeBasis();
  const rgba32 = basis.transcoder_texture_format.cTFRGBA32.value, astc6 = basis.basis_tex_format.cASTC_LDR_6x6.value;
  return (ktx2, role) => {
    const file = new basis.KTX2File(ktx2);
    let rgba: Uint8Array, width: number, height: number, levels: number;
    try {
      if (!file.isValid() || !file.startTranscoding()) return undefined;
      ({origWidth: width, origHeight: height} = file.getImageLevelInfo(0, 0, 0));
      levels = file.getLevels();
      rgba = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, rgba32));
      if (file.transcodeImage(rgba, 0, 0, 0, rgba32, 0, -1, -1) === 0) return undefined;
    } finally { file.close(); file.delete(); }
    const encoder = new basis.BasisEncoder();
    try {
      encoder.setDebug(false); encoder.setStatusOutput(false);
      encoder.setCreateKTX2File(true); encoder.setKTX2UASTCSupercompression(true);
      if (!encoder.setSliceSourceImage(0, rgba, width, height, basis.ldr_image_type.cRGBA32.value)) return undefined;
      // The CLI's order: the format flag, the role's preset, then the effort over both.
      encoder.setFormatMode(astc6);
      encoder[PRESET[role]]();
      encoder.setFormatModeAndQualityEffort(astc6, -1, 4, false);
      encoder.setMipGen(levels > 1); encoder.setMipSRGB(role === 'srgb');
      const out = new Uint8Array(width * height * 4 + (1 << 20)), length = encoder.encode(out);
      return length > 0 ? out.slice(0, length) : undefined;
    } finally { encoder.delete(); }
  };
}

/** A worker thread's loop around `loadBasisuAstc6`; workers inherit the cook's `--import` loader. */
const WORKER = `const {parentPort, workerData} = process.getBuiltinModule('node:worker_threads');
import(workerData.module).then(async module => {
  const encode = await module.loadBasisuAstc6();
  parentPort.on('message', ({id, bytes, role}) => { let out; try { out = encode(bytes, role); } catch { out = undefined; } parentPort.postMessage({id, out}); });
  parentPort.postMessage({ready: true});
});`;

export interface WasmAstc6 {
  readonly encode: Astc6Encode;
  /** Collects an input for `flush` and answers as an encode would, so a recording pass follows the real pass's path. */
  readonly record: Astc6Encode;
  readonly flush: () => Promise<void>;
  readonly stats: {encoded: number; reused: number; failed: number};
}

/** The cook's 6×6 encoder: `lanes` worker threads for `flush`, this thread for anything `flush` didn't see. */
export async function wasmAstc6(options: {readonly cacheDir?: string; readonly lanes?: number} = {}): Promise<WasmAstc6> {
  // Each lane holds its own WebAssembly heap; six keep a cook well inside the job's resident limit.
  const {cacheDir} = options, lanes = Math.max(1, Math.min(MAX_LANES, options.lanes ?? availableParallelism() - 2));
  if (cacheDir !== undefined) mkdirSync(cacheDir, {recursive: true});
  const stats = {encoded: 0, reused: 0, failed: 0};
  const keyOf = (ktx2: Uint8Array, role: TextureRole): string => createHash('sha256').update(`${KEY_PREFIX}${role}|`).update(ktx2).digest('hex');
  const done = new Map<string, Uint8Array | null>(), pending = new Map<string, {bytes: Uint8Array; role: TextureRole}>();
  const stored = (key: string): Uint8Array | undefined => {
    if (cacheDir === undefined) return undefined;
    const path = join(cacheDir, `${key}.ktx2`);
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
  };
  const keep = (key: string, out: Uint8Array | undefined): void => {
    done.set(key, out ?? null);
    if (out === undefined) { stats.failed++; return; }
    stats.encoded++;
    if (cacheDir !== undefined) { const path = join(cacheDir, `${key}.ktx2`), temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, out); renameSync(temp, path); }
  };
  const here = await loadBasisuAstc6();
  const encode: Astc6Encode = (ktx2, role) => {
    const key = keyOf(ktx2, role), kept = done.get(key);
    if (kept !== undefined) return kept ?? undefined;
    const hit = stored(key);
    if (hit !== undefined) { stats.reused++; done.set(key, hit); return hit; }
    let out: Uint8Array | undefined;
    try { out = here(ktx2, role); } catch { out = undefined; }
    keep(key, out);
    return out;
  };
  const record: Astc6Encode = (ktx2, role) => {
    const key = keyOf(ktx2, role);
    if (!done.has(key) && stored(key) === undefined) pending.set(key, {bytes: new Uint8Array(ktx2), role});
    return ktx2;
  };
  const flush = async (): Promise<void> => {
    const jobs = [...pending]; pending.clear();
    if (jobs.length === 0) return;
    const count = Math.min(lanes, jobs.length);
    const module = new URL('astc6Wasm.ts', import.meta.url).href;
    const workers = Array.from({length: count}, () => new Worker(WORKER, {eval: true, workerData: {module}}));
    try {
      await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
        let id = 0;
        const next = (): void => {
          const job = jobs.shift();
          if (job === undefined) { resolve(); return; }
          id++;
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port has no origin.
          worker.postMessage({id, bytes: job[1].bytes, role: job[1].role});
          // A lane's refusal isn't kept: the real pass encodes that input again on this thread, and counts a failure there.
          worker.once('message', ({out}: {out?: Uint8Array}) => { if (out !== undefined) keep(job[0], new Uint8Array(out)); next(); });
        };
        worker.once('message', () => { next(); });
        worker.once('error', reject);
        // A lane that dies leaves its inputs to this thread.
        worker.once('exit', () => { resolve(); });
      })));
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  };
  return {encode, record, flush, stats};
}
