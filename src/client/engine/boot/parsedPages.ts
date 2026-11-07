/** Private worker transfer format: bounded JSON token pages, never a cloned
 * descriptor tree. Admission still runs on the completely reconstructed tree. */
/** Native fatal UTF-8/JSON semantics, then bounded live-parser transfer pages. */
export function parseJsonPages(bytes: Uint8Array): Uint8Array {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return encodeParsedPages(value);
}

type Token = readonly ['o' | 'a', number] | readonly ['s', string, boolean]
  | readonly ['n', string] | readonly ['v', boolean | null];

function* tokens(input: unknown): Generator<Token> {
  const pending: unknown[] = [input];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') {
      if (value.length === 0) yield ['s', '', true];
      for (let at = 0; at < value.length; at += 256) yield ['s', value.slice(at, at + 256), at + 256 >= value.length];
    } else if (typeof value === 'number') yield ['n', Object.is(value, -0) ? '-0' : String(value)];
    else if (value === null || typeof value === 'boolean') yield ['v', value];
    else if (Array.isArray(value)) {
      yield ['a', value.length];
      for (let at = value.length - 1; at >= 0; at--) pending.push(value[at]);
    } else if (typeof value === 'object') {
      const entries = Object.entries(value);
      yield ['o', entries.length];
      for (let at = entries.length - 1; at >= 0; at--) {
        const entry = entries[at];
        if (entry === undefined) throw new Error('Missing parsed entry');
        pending.push(entry[1], entry[0]);
      }
    } else throw new TypeError('Invalid parsed value');
  }
}

/** Called only on the worker's native JSON.parse result. */
export function encodeParsedPages(value: unknown): Uint8Array {
  const encoder = new TextEncoder(), pages: Uint8Array[] = [];
  let page: string[] = [], characters = 0, bytes = 0;
  const flush = (): void => {
    if (page.length === 0) return;
    const encoded = encoder.encode(`[${page.join(',')}]`);
    pages.push(encoded); bytes += 4 + encoded.length; page = []; characters = 0;
  };
  for (const token of tokens(value)) {
    const text = JSON.stringify(token);
    if (page.length >= 32 || characters + text.length > 4096) flush();
    page.push(text); characters += text.length + 1;
  }
  flush();
  const output = new Uint8Array(bytes), view = new DataView(output.buffer);
  let at = 0;
  for (const part of pages) { view.setUint32(at, part.length, true); output.set(part, at + 4); at += 4 + part.length; }
  return output;
}

type Frame = {readonly value: unknown[]; remaining: number}
  | {readonly value: Record<string, unknown>; remaining: number; key: string | undefined};

/** Yield between every bounded native decode/parse and tree-construction page.
 * Nothing caller-visible is published until the entire transfer is checked. */
export async function decodeParsedPages(bytes: Uint8Array, pause: () => Promise<void>): Promise<unknown> {
  const frames: Frame[] = [], decoder = new TextDecoder('utf-8', {fatal: true});
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let root: unknown, hasRoot = false, string: string | undefined;
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
    } else { frame.value.push(value); frame.remaining--; }
  };
  const complete = (): void => { while (frames.at(-1)?.remaining === 0) frames.pop(); };
  for (let at = 0; at < bytes.length;) {
    await pause();
    if (at + 4 > bytes.length) throw new Error('Incomplete parsed page');
    const length = view.getUint32(at, true); at += 4;
    if (length === 0 || length > 16_384 || length > bytes.length - at) throw new Error('Invalid parsed page');
    const page: unknown = JSON.parse(decoder.decode(bytes.subarray(at, at + length))); at += length;
    if (!Array.isArray(page) || page.length === 0 || page.length > 32) throw new Error('Invalid parsed tokens');
    for (const token of page) {
      if (!Array.isArray(token)) throw new Error('Invalid parsed token');
      const [kind, value, last] = token;
      if (kind === 's' && token.length === 3 && typeof value === 'string' && value.length <= 256 && typeof last === 'boolean') {
        string = (string ?? '') + value;
        if (last) { put(string); string = undefined; complete(); }
        continue;
      }
      if (string !== undefined || token.length !== 2) throw new Error('Incomplete parsed string');
      if ((kind === 'o' || kind === 'a') && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        if (kind === 'a') {
          const container: unknown[] = []; put(container);
          if (value > 0) frames.push({value: container, remaining: value});
        } else {
          const container: Record<string, unknown> = {}; put(container);
          if (value > 0) frames.push({value: container, remaining: value, key: undefined});
        }
      } else if (kind === 'n' && typeof value === 'string' && (value === '-0' || String(Number(value)) === value)) put(Number(value));
      else if (kind === 'v' && (value === null || typeof value === 'boolean')) put(value);
      else throw new Error('Invalid parsed token');
      complete();
    }
  }
  if (!hasRoot || frames.length > 0 || string !== undefined) throw new Error('Incomplete parsed tree');
  await pause();
  return root;
}
