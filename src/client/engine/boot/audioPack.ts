import type { PackDef, PackPart } from '../../../shared/engine/boot/tables';

export interface AudioPackRead {
  readonly read: (url: string) => Promise<ArrayBuffer>;
  /** Release compressed backing once the bank has decoded every member. */
  readonly release: () => void;
}

/** One invocation owns compressed parts only until the selected bank finishes
 * decoding. Concurrent clips share a complete, content-verified part; every
 * decoder receives private bytes because decodeAudioData detaches its input. */
export function audioPackReader(pack: PackDef | undefined, allowed: ReadonlySet<string>, net: typeof fetch, signal?: AbortSignal): AudioPackRead {
  const members = new Map<string, { part: PackPart; offset: number; bytes: number }>();
  const loading = new Map<PackPart, Promise<ArrayBuffer>>();
  const request: RequestInit = signal === undefined ? {} : { signal };
  for (const part of pack?.parts ?? []) {
    if (part.bytes > 4_194_304 || !part.files.every(row => allowed.has(row[0]))) continue;
    let offset = 0;
    for (const [path, at, bytes] of part.files) {
      if (at !== offset || bytes <= 0 || members.has(path)) throw new Error('Invalid audio pack member');
      members.set(path, { part, offset: at, bytes }); offset += bytes;
    }
    if (offset !== part.bytes) throw new Error('Invalid audio pack byte charge');
  }
  const readPart = (part: PackPart): Promise<ArrayBuffer> => {
    let pending = loading.get(part);
    if (pending === undefined) {
      pending = (async () => {
        const response = await net(part.url, request);
        if (!response.ok) throw new Error(`Audio pack response ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== part.bytes) throw new Error('Audio pack byte length differs');
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
        if (!hash.startsWith(/-([a-f0-9]{8})\.bin$/u.exec(part.url)?.[1] ?? 'invalid')) throw new Error('Audio pack hash differs');
        return bytes;
      })();
      loading.set(part, pending);
    }
    return pending;
  };
  const read = async (url: string): Promise<ArrayBuffer> => {
    signal?.throwIfAborted();
    if (!allowed.has(url)) throw new Error('Audio read is outside its selected bank');
    const member = members.get(url);
    if (member !== undefined) {
      try { return (await readPart(member.part)).slice(member.offset, member.offset + member.bytes); }
      catch { signal?.throwIfAborted(); /* A missing/stale pack retains the original exact per-file read. */ }
    }
    const response = await net(url, request);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.arrayBuffer();
  };
  return { read, release: () => { loading.clear(); members.clear(); } };
}
