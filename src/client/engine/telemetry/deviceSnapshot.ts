// DEVICE-TELEMETRY DT1 (meta docs/plans/DEVICE-TELEMETRY-PLAN.md): one snapshot of the device this page runs on, gathered once per page,
// for the door's `client.device` line (shell.ts sends it on each socket) and Sentry's `device` context (browserErrors.ts).
// Every field is optional and every read is failure-safe: a browser without an API gives fewer fields, never a throw.
// Privacy line: device characteristics only, the ones any page can read. No IP address, no new persistent identifier, no fingerprint
// hash, and nothing that reads files, contacts, sensors, the camera, the microphone or location.
import { Scope } from '../../../shared/engine/app/scope';
import { cleanDevice, deviceTags, type DeviceSnapshot } from '../../../shared/engine/net/deviceWord';

declare const __BUILD_ID__: string | undefined;

/** What the snapshot reads; the page's globals by default, fakes in a test. */
export interface DeviceSources {
  readonly navigator?: unknown;
  readonly screen?: unknown;
  readonly devicePixelRatio?: unknown;
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
  readonly timeZone?: () => string | undefined;
  readonly build?: string;
}

/** What the game's own WebGL context says (never a new context). */
export type DeviceGpu = Pick<DeviceSnapshot, 'gpu' | 'gpuVendor' | 'maxTexture' | 'astc' | 'etc2' | 'bptc'>;

const HIGH_ENTROPY = ['model', 'platform', 'platformVersion', 'architecture', 'bitness', 'fullVersionList', 'formFactors', 'wow64'];
/** Client Hints can hang on a browser that never answers; the snapshot waits at most this long for them. */
const HINTS_WAIT_MS = 1500;

type Rec = Record<string, unknown>;
/** A property read that never throws (a getter may). */
const read = (from: unknown, key: string): unknown => {
  if (typeof from !== 'object' && typeof from !== 'function') return undefined;
  if (from === null) return undefined;
  try { return (from as Rec)[key]; } catch { return undefined; }
};
const said = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const brandList = (value: unknown): string[] | undefined => Array.isArray(value)
  ? value.map(entry => `${said(read(entry, 'brand'))} ${said(read(entry, 'version'))}`.trim()).filter(Boolean) : undefined;

async function hints(nav: unknown): Promise<Rec> {
  const data = read(nav, 'userAgentData');
  const out: Rec = { brands: brandList(read(data, 'brands')), mobile: read(data, 'mobile'), platform: read(data, 'platform') };
  const ask = read(data, 'getHighEntropyValues');
  if (typeof ask !== 'function') return out;
  const scope = new Scope('device.hints');
  try {
    const asked = Promise.resolve((ask as (hints: string[]) => unknown).call(data, HIGH_ENTROPY));
    const values = await Promise.race([asked, new Promise(resolve => { scope.timeout(HINTS_WAIT_MS, () => { resolve(null); }); })]);
    if (values === null || typeof values !== 'object') return out;
    for (const key of ['model', 'platform', 'platformVersion', 'architecture', 'bitness', 'wow64', 'formFactors']) {
      const value = read(values, key);
      if (value !== undefined && value !== '') out[key] = value;
    }
    out['fullVersionList'] = brandList(read(values, 'fullVersionList'));
  } catch { /* a refused hint leaves the low-entropy ones */ } finally { scope.dispose(); }
  return out;
}

function media(sources: DeviceSources, query: string): boolean | undefined {
  try { return sources.matchMedia?.(query).matches; } catch { return undefined; }
}

/** The snapshot from `sources`, without the GPU. Never throws. */
export async function collectDevice(sources: DeviceSources): Promise<DeviceSnapshot> {
  const nav = sources.navigator, screen = sources.screen, out: Rec = { build: sources.build };
  try { Object.assign(out, await hints(nav)); } catch { /* none */ }
  out['ua'] = read(nav, 'userAgent');
  out['screenW'] = read(screen, 'width'); out['screenH'] = read(screen, 'height');
  out['availW'] = read(screen, 'availWidth'); out['availH'] = read(screen, 'availHeight');
  out['orientation'] = read(read(screen, 'orientation'), 'type');
  out['dpr'] = sources.devicePixelRatio;
  out['cores'] = read(nav, 'hardwareConcurrency'); out['memory'] = read(nav, 'deviceMemory'); out['touch'] = read(nav, 'maxTouchPoints');
  out['pointer'] = media(sources, '(pointer: coarse)') === true ? 'coarse' : media(sources, '(pointer: fine)') === true ? 'fine' : media(sources, '(pointer: none)') === true ? 'none' : undefined;
  out['hover'] = media(sources, '(hover: hover)');
  out['language'] = read(nav, 'language');
  const languages = read(nav, 'languages');
  out['languages'] = Array.isArray(languages) ? [...languages as unknown[]] : undefined;
  try { out['timeZone'] = sources.timeZone?.(); } catch { /* none */ }
  const connection = read(nav, 'connection');
  out['net'] = read(connection, 'effectiveType'); out['downlink'] = read(connection, 'downlink'); out['saveData'] = read(connection, 'saveData');
  out['display'] = (['standalone', 'fullscreen', 'minimal-ui', 'browser'] as const).find(mode => media(sources, `(display-mode: ${mode})`) === true);
  return cleanDevice(out);
}

/** What the game's own context says about its GPU: the unmasked names, the largest texture, and the compressed forms it takes. Never throws. */
export function gpuFacts(gl: Pick<WebGLRenderingContext, 'getExtension' | 'getParameter' | 'RENDERER' | 'VENDOR' | 'MAX_TEXTURE_SIZE'>): DeviceGpu {
  const out: Rec = {};
  try {
    const info: { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number } | null = gl.getExtension('WEBGL_debug_renderer_info');
    out['gpu'] = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL);
    out['gpuVendor'] = gl.getParameter(info === null ? gl.VENDOR : info.UNMASKED_VENDOR_WEBGL);
  } catch { /* a lost context names nothing */ }
  try { out['maxTexture'] = gl.getParameter(gl.MAX_TEXTURE_SIZE); } catch { /* none */ }
  const has = (name: string): boolean | undefined => { try { return gl.getExtension(name) !== null; } catch { return undefined; } };
  out['astc'] = has('WEBGL_compressed_texture_astc'); out['etc2'] = has('WEBGL_compressed_texture_etc'); out['bptc'] = has('EXT_texture_compression_bptc');
  return cleanDevice(out);
}

/** The noted GPU lives on the window, not in this module: the online shell and the game can be separate bundles of the engine. */
const GPU_KEY = Symbol.for('wildshard.deviceGpu');
interface GpuHolder { [GPU_KEY]?: { facts: DeviceGpu | null; waiting: ((facts: DeviceGpu) => void)[] } }
const holder = (): NonNullable<GpuHolder[typeof GPU_KEY]> => {
  const host = globalThis as GpuHolder;
  host[GPU_KEY] ??= { facts: null, waiting: [] };
  return host[GPU_KEY];
};

/** The renderer's context is up (bootstrap.ts): note what it says, once per page. */
export function noteDeviceGpu(gl: Parameters<typeof gpuFacts>[0]): void {
  try {
    const held = holder();
    if (held.facts !== null) return;
    held.facts = gpuFacts(gl);
    for (const wake of held.waiting.splice(0)) wake(held.facts);
  } catch { /* telemetry never disrupts the boot */ }
}

/** The GPU noted so far, waiting at most `waitMs` for the renderer. */
function noted(waitMs: number): Promise<DeviceGpu> {
  const held = holder();
  if (held.facts !== null || waitMs <= 0) return Promise.resolve(held.facts ?? {});
  const scope = new Scope('device.gpu');
  return new Promise<DeviceGpu>(resolve => {
    const wake = (facts: DeviceGpu): void => { scope.dispose(); resolve(facts); };
    scope.timeout(waitMs, () => { held.waiting = held.waiting.filter(entry => entry !== wake); scope.dispose(); resolve({}); });
    held.waiting.push(wake);
  });
}

let page: Promise<DeviceSnapshot> | null = null;
/** This page's snapshot: gathered once, with the GPU once the renderer has said it (at most `gpuWaitMs`). Never rejects. */
export async function deviceSnapshot(gpuWaitMs = 0): Promise<DeviceSnapshot> {
  page ??= collectDevice(pageSources()).catch(() => ({}));
  const [device, gpu] = await Promise.all([page, noted(gpuWaitMs)]);
  return { ...device, ...gpu };
}

function pageSources(): DeviceSources {
  const scope = globalThis as unknown as { navigator?: unknown; screen?: unknown; devicePixelRatio?: unknown; matchMedia?: (query: string) => { matches: boolean } };
  const matchMedia = scope.matchMedia;
  return {
    navigator: scope.navigator, screen: scope.screen, devicePixelRatio: scope.devicePixelRatio,
    ...(typeof matchMedia === 'function' ? { matchMedia: (query: string) => matchMedia.call(globalThis, query) } : {}),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(typeof __BUILD_ID__ === 'string' ? { build: __BUILD_ID__ } : {}),
  };
}

/** The part of the Sentry SDK the device context needs. */
export interface SentryDeviceSink { setContext: (name: string, context: Record<string, unknown> | null) => void; setTags: (tags: Record<string, string>) => void }
/** DT2: Sentry's `device` context holds the whole snapshot, and its searchable tags are set (`device.model:*`). Only with a DSN built
 *  in, as every Sentry call; without one nothing is called. Never throws. */
export function applySentryDevice(sentry: SentryDeviceSink, device: DeviceSnapshot, dsn: string): boolean {
  if (dsn === '') return false;
  try { sentry.setContext('device', { ...device }); sentry.setTags(deviceTags(device)); return true; } catch { return false; }
}
