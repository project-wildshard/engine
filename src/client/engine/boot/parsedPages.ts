/** Private worker transfer format: binary tokens decoded in bounded steps, never a cloned
 * descriptor tree. Admission still runs on the completely reconstructed tree. */
/** Native fatal UTF-8/JSON semantics, then the live parser's binary token transfer. */
export function parseJsonPages(bytes: Uint8Array): Uint8Array {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return encodeParsedPages(value);
}

/* PZ23 (WILDSHARD-GAME-8G): binary tokens, so a number crosses as a float64 and the page thread makes no string for it
 * (the JSON token pages before made a token array and two strings a number: ~400 bytes of garbage, ~211 MB in the
 * first minute on Driftwood). Little-endian, after one version byte:
 *   OBJECT u32 count · ARRAY u32 count · NUMBER f64 · NULL · FALSE · TRUE
 *   UTF8 u8 last, u32 bytes, UTF-8 · UTF16 u8 last, u32 units, UTF-16 units (a string that is not well formed: a lone
 *   surrogate survives JSON.parse, never UTF-8). A string goes in parts of at most PART code units.
 *   REF u32 index: a short string sent before (at most SHORT code units: keys, names, kinds), the index-th such string in
 *   send order, so a repeated key costs the page thread no view and no decode. */
const VERSION = 0x57, OBJECT = 1, ARRAY = 2, UTF8 = 3, UTF16 = 4, NUMBER = 5, NULL = 6, FALSE = 7, TRUE = 8, REF = 9;
const SHORT = 64;
/** A string part's code units, and a decode step's bounds: at most STEP_TOKENS tokens or STEP_BYTES transfer bytes. */
const PART = 4096, STEP_TOKENS = 32, STEP_BYTES = 16_384;

class Writer {
  bytes = new Uint8Array(65_536);
  view = new DataView(this.bytes.buffer);
  at = 0;
  private readonly encoder = new TextEncoder();
  private readonly short = new Map<string, number>();
  room(n: number): void {
    if (this.at + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.at + n) size *= 2;
    const next = new Uint8Array(size); next.set(this.bytes.subarray(0, this.at));
    this.bytes = next; this.view = new DataView(next.buffer);
  }
  tag(tag: number): void { this.room(1); this.bytes[this.at++] = tag; }
  count(tag: number, n: number): void { this.room(5); this.bytes[this.at] = tag; this.view.setUint32(this.at + 1, n, true); this.at += 5; }
  number(value: number): void { this.room(9); this.bytes[this.at] = NUMBER; this.view.setFloat64(this.at + 1, value, true); this.at += 9; }
  string(value: string): void {
    if (value.length <= SHORT) {
      const index = this.short.get(value);
      if (index !== undefined) { this.count(REF, index); return; }
      this.short.set(value, this.short.size);
    }
    // in a Unicode-mode class a whole pair is one code point, so only a lone surrogate matches
    const utf8 = !/[\uD800-\uDFFF]/u.test(value);
    if (value.length === 0) { this.part(UTF8, 1, 0); return; }
    for (let from = 0; from < value.length;) {
      let to = Math.min(value.length, from + PART);
      // never split a surrogate pair across UTF-8 parts
      if (utf8 && to < value.length && (value.codePointAt(to - 1) ?? 0) > 0xffff) to--;
      const last = to >= value.length ? 1 : 0;
      if (utf8) {
        this.room(6 + (to - from) * 3);
        const { written } = this.encoder.encodeInto(value.slice(from, to), this.bytes.subarray(this.at + 6));
        this.part(UTF8, last, written); this.at += written;
      } else {
        this.room(6 + (to - from) * 2);
        this.part(UTF16, last, to - from);
        // oxlint-disable-next-line unicorn/prefer-code-point -- UTF-16 units, not code points: a lone surrogate crosses as it is
        for (let i = from; i < to; i++, this.at += 2) this.view.setUint16(this.at, value.charCodeAt(i), true);
      }
      from = to;
    }
  }
  /** A string part's head; its body follows at `at`. */
  private part(tag: number, last: number, length: number): void {
    this.room(6); this.bytes[this.at] = tag; this.bytes[this.at + 1] = last; this.view.setUint32(this.at + 2, length, true); this.at += 6;
  }
}

/** Called only on the worker's native JSON.parse result. */
export function encodeParsedPages(input: unknown): Uint8Array {
  const out = new Writer(), pending: unknown[] = [input];
  out.tag(VERSION);
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') out.string(value);
    else if (typeof value === 'number') out.number(value);
    else if (value === null) out.tag(NULL);
    else if (typeof value === 'boolean') out.tag(value ? TRUE : FALSE);
    else if (Array.isArray(value)) {
      out.count(ARRAY, value.length);
      for (let at = value.length - 1; at >= 0; at--) pending.push(value[at]);
    } else if (typeof value === 'object') {
      const entries = Object.entries(value);
      out.count(OBJECT, entries.length);
      for (let at = entries.length - 1; at >= 0; at--) {
        const entry = entries[at];
        if (entry === undefined) throw new Error('Missing parsed entry');
        pending.push(entry[1], entry[0]);
      }
    } else throw new TypeError('Invalid parsed value');
  }
  return out.bytes.slice(0, out.at);
}

type Frame = {readonly value: unknown[]; remaining: number; next: number}
  | {readonly value: Record<string, unknown>; remaining: number; key: string | undefined};

/** Yield before every bounded decode step (at most 32 tokens or 16 KiB of transfer) and once at the end.
 * Nothing caller-visible is published until the entire transfer is checked. */
export async function decodeParsedPages(bytes: Uint8Array, pause: () => Promise<void>): Promise<unknown> {
  // ignoreBOM: each part is decoded alone, and a string may start with U+FEFF
  const frames: Frame[] = [], decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
  let slots = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let root: unknown, hasRoot = false, string: string | undefined;
  const short: string[] = [];
  const put = (value: unknown): void => {
    const frame = frames.at(-1);
    if (frame === undefined) {
      if (hasRoot) throw new Error('Extra parsed root');
      root = value; hasRoot = true;
    } else if ('key' in frame) {
      if (frame.key === undefined) {
        if (typeof value !== 'string') throw new Error('Invalid parsed key');
        frame.key = value; return;
      }
      if (Object.hasOwn(frame.value, frame.key)) throw new Error('Duplicate parsed key');
      Object.defineProperty(frame.value, frame.key, {value, writable: true, enumerable: true, configurable: true});
      frame.key = undefined; frame.remaining--;
    } else { frame.value[frame.next++] = value; frame.remaining--; }
  };
  const complete = (): void => { while (frames.at(-1)?.remaining === 0) frames.pop(); };
  const need = (at: number, n: number): void => { if (n > bytes.length - at) throw new Error('Incomplete parsed token'); };
  if (bytes.length === 0 || bytes[0] !== VERSION) throw new Error('Invalid parsed transfer');
  for (let at = 1; at < bytes.length;) {
    await pause();
    const stepEnd = at + STEP_BYTES;
    for (let tokens = 0; tokens < STEP_TOKENS && at < bytes.length && at < stepEnd; tokens++) {
      const tag = bytes[at++];
      if (tag === UTF8 || tag === UTF16) {
        need(at, 5);
        const last = bytes[at], length = view.getUint32(at + 1, true); at += 5;
        if ((last !== 0 && last !== 1) || length > (tag === UTF8 ? PART * 3 : PART)) throw new Error('Invalid parsed string');
        const size = tag === UTF8 ? length : length * 2;
        need(at, size);
        let part = '';
        if (tag === UTF8) part = decoder.decode(bytes.subarray(at, at + size));
        // oxlint-disable-next-line unicorn/prefer-code-point -- UTF-16 units, not code points: a lone surrogate crosses as it is
        else for (let i = 0; i < length; i++) part += String.fromCharCode(view.getUint16(at + i * 2, true));
        at += size;
        string = string === undefined ? part : string + part;
        if (last === 1) { if (string.length <= SHORT) short.push(string); put(string); string = undefined; complete(); }
        continue;
      }
      if (string !== undefined) throw new Error('Incomplete parsed string');
      if (tag === REF) {
        need(at, 4);
        const value = short[view.getUint32(at, true)]; at += 4;
        if (value === undefined) throw new Error('Invalid parsed reference');
        put(value); complete(); continue;
      }
      if (tag === OBJECT || tag === ARRAY) {
        need(at, 4);
        const count = view.getUint32(at, true); at += 4;
        // every element or entry takes at least one more byte, so no count, nor all of them together, sizes past the transfer
        slots += count;
        if (count > bytes.length - at || slots > bytes.length) throw new Error('Invalid parsed count');
        if (tag === ARRAY) {
          // sized once: a pushed array regrows and leaves its old backing stores behind
          // oxlint-disable-next-line unicorn/no-new-array -- a length: the decode fills every slot before anything is published
          const container: unknown[] = new Array<unknown>(count); put(container);
          if (count > 0) frames.push({value: container, remaining: count, next: 0});
        } else {
          const container: Record<string, unknown> = {}; put(container);
          if (count > 0) frames.push({value: container, remaining: count, key: undefined});
        }
      } else if (tag === NUMBER) {
        need(at, 8);
        const value = view.getFloat64(at, true); at += 8;
        if (Number.isNaN(value)) throw new Error('Invalid parsed number');
        put(value);
      } else if (tag === NULL) put(null);
      else if (tag === FALSE) put(false);
      else if (tag === TRUE) put(true);
      else throw new Error('Invalid parsed token');
      complete();
    }
  }
  if (!hasRoot || frames.length > 0 || string !== undefined) throw new Error('Incomplete parsed tree');
  await pause();
  return root;
}
