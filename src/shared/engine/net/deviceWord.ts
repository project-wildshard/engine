// DEVICE-TELEMETRY DT3/DT4 (meta docs/plans/DEVICE-TELEMETRY-PLAN.md; Jake, 2026-11-13: "start gathering metadata for every single
// client that connects [...] so we can kind of reverse engineer what device is up playing"): the device word a client sends once per
// socket, and the one shape both sides bound it to. The client cuts its snapshot with `cleanDevice` before it sends; the door reads the
// word as untrusted input with `readDeviceWord` and logs `deviceLine`.
//
// Privacy line: device characteristics only, the ones any page can read (Client Hints, the User-Agent, the GPU name, screen, cores,
// memory, locale, connection type). No IP address, no new persistent identifier, no fingerprint hash, and nothing that reads files,
// contacts, sensors, the camera, the microphone or location.

/** The most bytes a device word may hold; a longer one is refused whole. Under the room's 1024-byte message cap
 *  (room.ts MAX_CLIENT_MESSAGE_BYTES), past which the socket itself closes `refused`. */
export const DEVICE_WORD_MAX_BYTES = 1000;
/** The `world` word's flag that says this door reads the device word. An older door never says it, so a client never sends one there:
 *  an older door closes `refused` on a control prefix it does not know (socketTransport.ts `receive`). */
export const DEVICE_WORD_FLAG = 'device';

/** Whether the door's `world` word says it reads the device word. Never throws. */
export function worldReadsDevice(bytes: ArrayBuffer): boolean {
  try { const said: unknown = JSON.parse(new TextDecoder().decode(bytes)); return typeof said === 'object' && said !== null && DEVICE_WORD_FLAG in said && said[DEVICE_WORD_FLAG] === 1; }
  catch { return false; }
}

type Kind = 'text' | 'long' | 'number' | 'flag' | 'list';
/** A device snapshot: every field optional. Nothing else crosses the wire. */
export interface DeviceSnapshot {
  readonly build?: string;
  // User-Agent Client Hints (Chromium): `model` names an Android phone ("Pixel 8", "SM-S918B")
  readonly ua?: string; readonly model?: string; readonly platform?: string; readonly platformVersion?: string; readonly architecture?: string;
  readonly bitness?: string; readonly wow64?: boolean; readonly mobile?: boolean;
  readonly brands?: readonly string[]; readonly fullVersionList?: readonly string[]; readonly formFactors?: readonly string[];
  // the game's own WebGL context
  readonly gpu?: string; readonly gpuVendor?: string; readonly maxTexture?: number; readonly astc?: boolean; readonly etc2?: boolean; readonly bptc?: boolean;
  readonly screenW?: number; readonly screenH?: number; readonly availW?: number; readonly availH?: number; readonly dpr?: number; readonly orientation?: string;
  readonly cores?: number; readonly memory?: number; readonly touch?: number; readonly pointer?: string; readonly hover?: boolean;
  readonly language?: string; readonly languages?: readonly string[]; readonly timeZone?: string;
  readonly net?: string; readonly downlink?: number; readonly saveData?: boolean;
  readonly display?: string;
}
type Field = keyof DeviceSnapshot;
/** Each field's kind, which `cleanDevice` bounds it by. */
const FIELDS: Readonly<Record<Field, Kind>> = {
  build: 'text',
  ua: 'long', model: 'text', platform: 'text', platformVersion: 'text', architecture: 'text', bitness: 'text', wow64: 'flag', mobile: 'flag',
  brands: 'list', fullVersionList: 'list', formFactors: 'list',
  gpu: 'text', gpuVendor: 'text', maxTexture: 'number', astc: 'flag', etc2: 'flag', bptc: 'flag',
  screenW: 'number', screenH: 'number', availW: 'number', availH: 'number', dpr: 'number', orientation: 'text',
  cores: 'number', memory: 'number', touch: 'number', pointer: 'text', hover: 'flag',
  language: 'text', languages: 'list', timeZone: 'text',
  net: 'text', downlink: 'number', saveData: 'flag',
  display: 'text',
};

const TEXT_MAX = 96, LONG_MAX = 320, LIST_ITEMS = 6, ITEM_MAX = 48;
// Bidi overrides, zero-width and other format characters would let a junk word reorder or hide text in a journal line
// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/gu;
const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cut = value.replaceAll(UNPRINTABLE, '').trim().slice(0, max);
  return cut === '' ? undefined : cut;
};

/** A snapshot cut to the known fields and their bounds: unknown fields, wrong types and non-finite numbers drop. Never throws. */
export function cleanDevice(raw: unknown): DeviceSnapshot {
  const out: Record<string, unknown> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [field, kind] of Object.entries(FIELDS) as [Field, Kind][]) {
    let value: unknown;
    try { value = (raw as Record<string, unknown>)[field]; } catch { continue; }
    if (kind === 'text' || kind === 'long') { const said = text(value, kind === 'long' ? LONG_MAX : TEXT_MAX); if (said !== undefined) out[field] = said; }
    else if (kind === 'number') { if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e9) out[field] = Math.round(value * 1000) / 1000; }
    else if (kind === 'flag') { if (typeof value === 'boolean') out[field] = value; }
    else if (Array.isArray(value)) {
      const items = value.slice(0, LIST_ITEMS).map(item => text(item, ITEM_MAX)).filter((item): item is string => item !== undefined);
      if (items.length > 0) out[field] = items;
    }
  }
  return out;
}

/** What a word too long sheds first, in order: the least telling fields go, the model and GPU stay. */
const SHED: readonly Field[] = ['fullVersionList', 'languages', 'brands', 'formFactors', 'ua', 'availW', 'availH', 'downlink', 'orientation', 'timeZone', 'gpuVendor'];
/** The word a client sends: its cleaned snapshot as JSON, under DEVICE_WORD_MAX_BYTES (fields shed in SHED's order until it fits). */
export function encodeDeviceWord(snapshot: DeviceSnapshot): ArrayBuffer {
  const encoder = new TextEncoder(), clean: Record<string, unknown> = { ...cleanDevice(snapshot) };
  let bytes = encoder.encode(JSON.stringify(clean));
  for (const field of SHED) {
    if (bytes.byteLength <= DEVICE_WORD_MAX_BYTES) break;
    delete clean[field]; bytes = encoder.encode(JSON.stringify(clean));
  }
  return bytes.byteLength > DEVICE_WORD_MAX_BYTES ? encoder.encode('{}').buffer : bytes.buffer;
}

/** The door's read of a device word: untrusted bytes, so an oversized, non-JSON or non-object word is null. Never throws. */
export function readDeviceWord(bytes: ArrayBuffer): DeviceSnapshot | null {
  if (bytes.byteLength === 0 || bytes.byteLength > DEVICE_WORD_MAX_BYTES) return null;
  let said: unknown;
  try { said = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return null;
  return cleanDevice(said);
}

/** The browser and its major version, from the Client Hints brands, else the User-Agent. */
export function deviceBrowser(device: DeviceSnapshot): string | undefined {
  const brand = [...(device.fullVersionList ?? []), ...(device.brands ?? [])].find(entry => !/not.?a.?brand|chromium/iu.test(entry));
  if (brand !== undefined) return brand;
  const ua = device.ua ?? '';
  const found = /(Firefox|FxiOS|EdgA?|SamsungBrowser|OPR|CriOS|Chrome)\/(\d+)/u.exec(ua) ?? /Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari/u.exec(ua);
  if (found === null) return undefined;
  return found.length === 3 ? `${found[1] ?? ''} ${found[2] ?? ''}` : `Safari ${found[1] ?? ''}`;
}

/** The door's one journal line per connect: who (the player id the hello already carries, never an address) and what device. */
export function deviceLine(player: string, device: DeviceSnapshot): Record<string, unknown> {
  const line: Record<string, unknown> = { at: 'client.device', player };
  const put = (key: string, value: unknown): void => { if (value !== undefined) line[key] = value; };
  put('model', device.model); put('platform', device.platform); put('platformVersion', device.platformVersion);
  put('browser', deviceBrowser(device)); put('gpu', device.gpu); put('gpuVendor', device.gpuVendor);
  put('screen', device.screenW !== undefined && device.screenH !== undefined ? `${String(device.screenW)}x${String(device.screenH)}` : undefined);
  put('dpr', device.dpr); put('memory', device.memory); put('cores', device.cores); put('touch', device.touch); put('mobile', device.mobile);
  put('formFactors', device.formFactors?.join(',')); put('architecture', device.architecture); put('maxTexture', device.maxTexture);
  put('textures', [device.astc === true ? 'astc' : '', device.etc2 === true ? 'etc2' : '', device.bptc === true ? 'bptc' : ''].filter(Boolean).join(',') || undefined);
  put('language', device.language); put('timeZone', device.timeZone); put('net', device.net); put('display', device.display);
  put('build', device.build); put('ua', device.ua);
  return line;
}

/** SENTRY: the searchable tags (`device.model:*`), each under Sentry's 200-character tag value limit. */
export function deviceTags(device: DeviceSnapshot): Record<string, string> {
  const tags: Record<string, string> = {};
  const put = (key: string, value: string | number | undefined): void => { if (value !== undefined && value !== '') tags[key] = String(value).slice(0, 200); };
  put('device.model', device.model); put('device.gpu', device.gpu); put('device.platform', device.platform);
  put('device.platform_version', device.platformVersion); put('device.memory', device.memory);
  return tags;
}
