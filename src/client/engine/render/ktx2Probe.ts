/**
 * The KTX2 capability probe (E435 ktx2-probe): does this GPU sample MIPMAPPED compressed textures correctly?
 *
 * The iOS Simulator advertises ASTC/ETC2, but Safari reads lower mips of sRGB ASTC and ETC2/EAC as [0, 0, 0, 0].
 * Independent controls confirm linear ASTC and RGBA8 at every mip; single-level RGB-only ETC2 also decodes incorrectly.
 * Single-level ASTC and ETC2/EAC RGBA work. This is a sampling failure, not absent extensions or an iPhone hardware
 * capability claim. Every device is probed independently: Pine Hollow's needle cards lost their alpha (bare black
 * branches) and the ETC2 roughness / AO planes read 0 (mirror-white ground). `extensions.has()` cannot see that, so once
 * per page, before the texture mode resolves to KTX2 (src/client/engine/boot/gpuFiles.ts texModeWhy), this uploads one 8×8,
 * 4-level texture per format the Basis transcoder can target — through three's own path (texStorage2D, then
 * compressedTexSubImage2D per level) — samples every level with textureLod into an RGBA8 target, reads it back once and
 * compares each texel with the colour the block encodes.
 *
 *   ktx2Probe()              runs it (memoized; a throw-away WebGL2 context, lost again at once) — `ran: false` without a
 *                            page or a context: no verdict, nothing changes
 *   ktx2ProbeResult()        the result when it has run, else null (never runs it: the background download only peeks)
 *   applyKtx2Probe(config)   turns the failing families off in the KTX2 loader's transcoder config (core/ktx2.ts)
 *   probeVeto(...)           pure: images instead, when dropping the failing families leaves a Basis format with only the
 *                            uncompressed RGBA32 target — a page of uncompressed KTX2 costs what the images do, and the
 *                            image path is the one every shard is tested on
 *
 * The result rides on `window.__wildshard.textures()` and the Developer perf panel's DEVICE section (ui/perfHud.ts).
 */

import { harnessPins } from '../../../shared/engine/app/identity';

/** a transcoder target family, as the KTX2 loader's worker config names its flags */
export type Ktx2Family = 'astc' | 'etc2' | 'bptc' | 's3tc';
const FLAG = { astc: 'astcSupported', etc2: 'etc2Supported', bptc: 'bptcSupported', s3tc: 'dxtSupported' } as const;
const FAMILIES = ['astc', 'etc2', 'bptc', 's3tc'] as const;

/** the transcoder flags this probe reads and writes (three's KTX2LoaderWorkerConfig has these and more) */
export interface TranscoderFlags {
  astcSupported: boolean; etc2Supported: boolean; etc1Supported: boolean; bptcSupported: boolean; dxtSupported: boolean; pvrtcSupported: boolean;
}

export interface Ktx2FormatResult {
  readonly family: Ktx2Family;
  readonly format: string;
  readonly ok: boolean;
  /** the first wrong level and what it read (failures only) */
  readonly level?: number;
  readonly read?: readonly number[];
  readonly expected?: readonly number[];
  /** a GL error raised by the upload (failures only) */
  readonly glError?: number;
}

export interface Ktx2Probe {
  /** false: no page / no WebGL2 context to probe on — no verdict, KTX2 is left as detected */
  readonly ran: boolean;
  readonly note: string;
  /** each family with an extension: true when every format of it sampled right at every level */
  readonly families: Readonly<Partial<Record<Ktx2Family, boolean>>>;
  readonly formats: readonly Ktx2FormatResult[];
  /** why this page must load images instead of KTX2, or null */
  readonly veto: string | null;
}

interface Candidate { family: Ktx2Family; format: string; ext: string; gl: number; block: Uint8Array; expected: readonly number[]; srgb: boolean; edge: number }

const SIZE = 8, LEVELS = 4, TOLERANCE = 12;

/** ASTC void-extent block, the same at every footprint: one constant colour as UNORM16 (0.8, 0.4, 0.2, 0.6) */
function astcBlock(): Uint8Array {
  const b = new Uint8Array(16);
  b.set([0xfc, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const v = new DataView(b.buffer);
  [0xcccc, 0x6666, 0x3333, 0x9999].forEach((c, i) => { v.setUint16(8 + i * 2, c, true); });
  return b;
}
/** ETC2 individual-mode block: base (0xCC, 0x66, 0x33), table 0, every index 0 (+2) → (206, 104, 53) */
const ETC_RGB = [0xcc, 0x66, 0x33, 0x00, 0, 0, 0, 0];
/** EAC alpha block: base 153, multiplier 1, table 0, every index 4 (+2) → 155 */
const EAC_ALPHA = [153, 0x10, 0x92, 0x49, 0x24, 0x92, 0x49, 0x24];
/** BC7 mode 6: both endpoints (204, 102, 50, 154), p-bits 0, every index 0 */
function bc7Block(): Uint8Array {
  const b = new Uint8Array(16);
  let at = 0;
  const put = (value: number, bits: number): void => {
    for (let i = 0; i < bits; i++, at++) if ((value >> i) & 1) b[at >> 3] = (b[at >> 3] ?? 0) | (1 << (at & 7));
  };
  put(1 << 6, 7);
  for (const c of [102, 51, 25, 77]) { put(c, 7); put(c, 7); } // R0 R1 G0 G1 B0 B1 A0 A1 (7 bits each, value >> 1)
  return b;
}
/** BC1 colour block: both endpoints RGB565 (25, 25, 6) → (206, 101, 49), every index 0 */
const BC1 = [0x26, 0xcb, 0x26, 0xcb, 0, 0, 0, 0];
/** BC3's alpha block: both endpoints 153, every index 0 */
const BC3_ALPHA = [153, 153, 0, 0, 0, 0, 0, 0];

const linear = (c: number): number => { const s = c / 255; return Math.round(255 * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)); };

function candidates(): Candidate[] {
  const out: Candidate[] = [];
  const add = (family: Ktx2Family, format: string, ext: string, gl: number, block: Uint8Array | readonly number[], rgba: readonly number[], srgb: boolean, edge = 4): void => {
    const [r = 0, g = 0, b = 0, a = 255] = rgba;
    out.push({ family, format, ext, gl, block: Uint8Array.from(block), srgb, edge, expected: srgb ? [linear(r), linear(g), linear(b), a] : [r, g, b, a] });
  };
  const astc = astcBlock(), etcRgba = [...EAC_ALPHA, ...ETC_RGB], bc7 = bc7Block(), bc3 = [...BC3_ALPHA, ...BC1];
  add('astc', 'RGBA_ASTC_4x4', 'WEBGL_compressed_texture_astc', 0x93b0, astc, [204, 102, 51, 153], false);
  add('astc', 'SRGB8_ALPHA8_ASTC_4x4', 'WEBGL_compressed_texture_astc', 0x93d0, astc, [204, 102, 51, 153], true);
  // S4: the extension promises every footprint, but a phone's overlay reads raw 6×6 with no transcode: it is proved too
  add('astc', 'RGBA_ASTC_6x6', 'WEBGL_compressed_texture_astc', 0x93b4, astc, [204, 102, 51, 153], false, 6);
  add('astc', 'SRGB8_ALPHA8_ASTC_6x6', 'WEBGL_compressed_texture_astc', 0x93d4, astc, [204, 102, 51, 153], true, 6);
  add('etc2', 'RGB8_ETC2', 'WEBGL_compressed_texture_etc', 0x9274, ETC_RGB, [206, 104, 53, 255], false);
  add('etc2', 'SRGB8_ETC2', 'WEBGL_compressed_texture_etc', 0x9275, ETC_RGB, [206, 104, 53, 255], true);
  add('etc2', 'RGBA8_ETC2_EAC', 'WEBGL_compressed_texture_etc', 0x9278, etcRgba, [206, 104, 53, 155], false);
  add('etc2', 'SRGB8_ALPHA8_ETC2_EAC', 'WEBGL_compressed_texture_etc', 0x9279, etcRgba, [206, 104, 53, 155], true);
  add('bptc', 'RGBA_BPTC_UNORM', 'EXT_texture_compression_bptc', 0x8e8c, bc7, [204, 102, 50, 154], false);
  add('bptc', 'SRGB_ALPHA_BPTC_UNORM', 'EXT_texture_compression_bptc', 0x8e8d, bc7, [204, 102, 50, 154], true);
  add('s3tc', 'RGB_S3TC_DXT1', 'WEBGL_compressed_texture_s3tc', 0x83f0, BC1, [206, 101, 49, 255], false);
  add('s3tc', 'RGBA_S3TC_DXT5', 'WEBGL_compressed_texture_s3tc', 0x83f3, bc3, [206, 101, 49, 153], false);
  add('s3tc', 'SRGB_S3TC_DXT1', 'WEBGL_compressed_texture_s3tc_srgb', 0x8c4c, BC1, [206, 101, 49, 255], true);
  add('s3tc', 'SRGB_ALPHA_S3TC_DXT5', 'WEBGL_compressed_texture_s3tc_srgb', 0x8c4f, bc3, [206, 101, 49, 153], true);
  return out;
}

const VS = '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FS = '#version 300 es\nprecision highp float;uniform highp sampler2D t;uniform float lod;out vec4 o;void main(){o=textureLod(t,vec2(.5),lod);}';

/**
 * Upload and sample every format this context has an extension for (8×8, 4 levels, three's texStorage2D +
 * compressedTexSubImage2D path), one readPixels for all of them. Everything it creates is deleted before it returns.
 */
export function probeCompressedMips(gl: WebGL2RenderingContext): { families: Partial<Record<Ktx2Family, boolean>>; formats: Ktx2FormatResult[]; available: TranscoderFlags } {
  const has = (ext: string): boolean => gl.getExtension(ext) !== null;
  const available: TranscoderFlags = {
    astcSupported: has('WEBGL_compressed_texture_astc'), etc2Supported: has('WEBGL_compressed_texture_etc'), etc1Supported: has('WEBGL_compressed_texture_etc1'),
    bptcSupported: has('EXT_texture_compression_bptc'), dxtSupported: has('WEBGL_compressed_texture_s3tc'),
    pvrtcSupported: has('WEBGL_compressed_texture_pvrtc') || has('WEBKIT_WEBGL_compressed_texture_pvrtc'),
  };
  const list = candidates().filter((c) => has(c.ext));
  const formats: Ktx2FormatResult[] = [], families: Partial<Record<Ktx2Family, boolean>> = {};
  if (list.length === 0) return { families, formats, available };
  const shader = (type: number, src: string): WebGLShader | null => { const s = gl.createShader(type); if (s === null) return null; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS), prog = gl.createProgram();
  const buffer = gl.createBuffer(), target = gl.createTexture(), fbo = gl.createFramebuffer();
  const textures: WebGLTexture[] = [];
  try {
    if (vs === null || fs === null) throw new Error('probe objects unavailable');
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
    const linked: unknown = gl.getProgramParameter(prog, gl.LINK_STATUS);
    if (linked !== true) throw new Error(`probe program: ${gl.getProgramInfoLog(prog) ?? ''}`);
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, 't'), 0);
    const lod = gl.getUniformLocation(prog, 'lod');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, LEVELS, list.length);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0); gl.viewport(0, 0, LEVELS, list.length); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.getError(); // start clean: a stale error is not this probe's
    const errors: number[] = [];
    list.forEach((c, row) => {
      const tex = gl.createTexture();
      textures.push(tex);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texStorage2D(gl.TEXTURE_2D, LEVELS, c.gl, SIZE, SIZE);
      for (let level = 0; level < LEVELS; level++) {
        const s = Math.max(1, SIZE >> level), blocks = Math.ceil(s / c.edge) ** 2, data = new Uint8Array(blocks * c.block.length);
        for (let i = 0; i < blocks; i++) data.set(c.block, i * c.block.length);
        gl.compressedTexSubImage2D(gl.TEXTURE_2D, level, 0, 0, s, s, c.gl, data);
      }
      errors.push(gl.getError());
      for (let level = 0; level < LEVELS; level++) {
        gl.viewport(level, row, 1, 1);
        gl.uniform1f(lod, level);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    });
    const px = new Uint8Array(LEVELS * list.length * 4);
    gl.readPixels(0, 0, LEVELS, list.length, gl.RGBA, gl.UNSIGNED_BYTE, px);
    list.forEach((c, row) => {
      const glError = errors[row] ?? 0;
      let result: Ktx2FormatResult = { family: c.family, format: c.format, ok: glError === 0 };
      if (glError !== 0) result = { ...result, glError };
      else for (let level = 0; level < LEVELS; level++) {
        const at = (row * LEVELS + level) * 4, read = [...px.subarray(at, at + 4)];
        if (read.some((v, i) => Math.abs(v - (c.expected[i] ?? 0)) > TOLERANCE)) { result = { ...result, ok: false, level, read, expected: c.expected }; break; }
      }
      formats.push(result);
      families[c.family] = (families[c.family] ?? true) && result.ok;
    });
    return { families, formats, available };
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null); gl.useProgram(null);
    for (const t of textures) gl.deleteTexture(t);
    gl.deleteTexture(target); gl.deleteFramebuffer(fbo); gl.deleteBuffer(buffer); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
  }
}

/**
 * A Basis format reaches a compressed target under these flags (three's KTX2Loader priority lists; ETC1S ranks ASTC after
 * RGBA32). ETC1 is not counted: three allocates it with texStorage2D, which WebGL2 refuses for ETC1 (GL_INVALID_OPERATION in
 * Chromium and WebKit alike), so it is no target on a WebGL2 page whatever the probe says — and is not probed, to keep a
 * GL error out of every boot's console.
 */
function compressed(flags: TranscoderFlags, basis: 'UASTC' | 'ETC1S'): boolean {
  const shared = flags.bptcSupported || flags.etc2Supported || flags.dxtSupported || flags.pvrtcSupported;
  return basis === 'UASTC' ? shared || flags.astcSupported : shared;
}

/** the flags with every family that failed the probe turned off */
export function withoutFailing(flags: TranscoderFlags, families: Readonly<Partial<Record<Ktx2Family, boolean>>>): TranscoderFlags {
  const out: TranscoderFlags = { astcSupported: flags.astcSupported, etc2Supported: flags.etc2Supported, etc1Supported: flags.etc1Supported,
    bptcSupported: flags.bptcSupported, dxtSupported: flags.dxtSupported, pvrtcSupported: flags.pvrtcSupported };
  for (const family of FAMILIES) if (families[family] === false) out[FLAG[family]] = false;
  return out;
}

/**
 * Why to load images instead, or null: a Basis format (UASTC / ETC1S) that had a compressed target on this GPU has none
 * once the failing families are dropped — it would transcode to uncompressed RGBA32.
 */
export function probeVeto(available: TranscoderFlags, families: Readonly<Partial<Record<Ktx2Family, boolean>>>, formats: readonly Ktx2FormatResult[]): string | null {
  const after = withoutFailing(available, families);
  const lost: string[] = [];
  for (const basis of ['UASTC', 'ETC1S'] as const) if (compressed(available, basis) && !compressed(after, basis)) lost.push(basis);
  if (lost.length === 0) return null;
  return `KTX2 probe: ${failureLine(formats)} — no compressed target left for ${lost.join(', ')}`;
}

/** "SRGB8_ALPHA8_ASTC_4x4 L1 0,0,0,0; RGB8_ETC2 L0 GL 1280" */
function failureLine(formats: readonly Ktx2FormatResult[]): string {
  return formats.filter((f) => !f.ok).map((f) => `${f.format} ${f.glError !== undefined ? `GL ${String(f.glError)}` : `L${String(f.level ?? 0)} ${(f.read ?? []).join(',')}`}`).join('; ');
}

let result: Ktx2Probe | null = null;

/** run the probe once per page (memoized) on a throw-away WebGL2 context */
export function ktx2Probe(): Ktx2Probe {
  if (result !== null) return result;
  if (typeof document === 'undefined') { result = { ran: false, note: 'no page', families: {}, formats: [], veto: null }; return result; }
  // G386: a measurement-only harness pin (the iOS Simulator's frame floor) skips the probe — no verdict, KTX2 as detected
  if (harnessPins()?.ktx2Probe === 'skip') { result = { ran: false, note: 'skipped (harness pin, measurement only: pixels may be wrong)', families: {}, formats: [], veto: null }; return result; }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  let gl: WebGL2RenderingContext | null = null;
  try {
    // the game's context attributes' power preference (core/webglStartup.ts, E257: high-performance is lost after a crash)
    const made: unknown = canvas.getContext('webgl2', { powerPreference: 'default', antialias: false, depth: false, stencil: false, alpha: true });
    // a real WebGL2 context only (a test's canvas stand-in, or a page without WebGL2, is no verdict)
    gl = typeof WebGL2RenderingContext === 'function' && made instanceof WebGL2RenderingContext ? made : null;
    if (gl === null || gl.isContextLost()) result = { ran: false, note: 'no WebGL2 context', families: {}, formats: [], veto: null };
    else {
      const probe = probeCompressedMips(gl);
      const veto = probeVeto(probe.available, probe.families, probe.formats);
      const failing = probe.formats.some((f) => !f.ok);
      result = { ran: true, note: failing ? failureLine(probe.formats) : `${String(probe.formats.length)} formats ok`, families: probe.families, formats: probe.formats, veto };
      if (veto !== null) console.warn(`[ktx2] ${veto} → images`);
      else if (failing) console.warn(`[ktx2] probe: ${result.note} — the transcoder skips those families`);
      else console.info(`[ktx2] probe: ${result.note} (${Object.keys(probe.families).join(' ')})`);
    }
  } catch (error) {
    result = { ran: false, note: `probe failed: ${error instanceof Error ? error.message : String(error)}`, families: {}, formats: [], veto: null };
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return result;
}

/** the probe's result when it has run on this page, else null (does not run it) */
export function ktx2ProbeResult(): Ktx2Probe | null { return result; }

/**
 * Pure: whether a page the probe turned to images can still sample LINEAR UASTC files compressed — the probe vetoed KTX2
 * and the linear ASTC 4×4 format read right at every level. The iOS Simulator zeroes the mips of sRGB ASTC and of ETC2
 * only, so its normal maps can stay ASTC (1 byte a texel instead of an image's 4): core/ktx2.ts linearKtx2Texture.
 */
export function linearAstcSurvives(probe: Ktx2Probe | null): boolean {
  return probe !== null && probe.ran && probe.veto !== null && probe.formats.some((f) => f.format === 'RGBA_ASTC_4x4' && f.ok);
}

/**
 * Turn the families that failed the probe off in a KTX2 loader's transcoder config (the transcoder then targets the next),
 * and ETC1 always: three's texStorage2D allocation of it fails on every WebGL2 context, and ETC1 is where ETC1S goes next
 * once ETC2 is off.
 */
export function applyKtx2Probe(config: TranscoderFlags): void {
  const probe = ktx2Probe();
  for (const family of FAMILIES) if (probe.families[family] === false) config[FLAG[family]] = false;
  config.etc1Supported = false;
}

/** one line for the Developer panels: the verdict and what failed */
export function ktx2ProbeLine(probe: Ktx2Probe | null): string {
  if (probe === null) return 'not run (this page did not resolve to KTX2)';
  if (!probe.ran) return `no verdict (${probe.note})`;
  const fams = Object.entries(probe.families).map(([f, ok]) => `${f} ${ok ? 'ok' : 'FAIL'}`).join(' · ');
  return `${fams}${probe.formats.some((f) => !f.ok) ? ` · ${probe.note}` : ''}${probe.veto !== null ? ' · → images' : ''}`;
}
