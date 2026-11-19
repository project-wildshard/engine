/** QA 11-19 row 19 (the slow line): the grid's entry downloads ride in the document's `boot-module-files` bank, which
 *  sits in the head ahead of `<body>`. Spelled out per mode and home they were 738 kB of an 850 kB document (8 modes
 *  that list the same rows, 640 rows over 50 distinct files), all parsed before the first paint. Packed, each file is
 *  listed once, each distinct home table once, and a mode names its table: about 5 kB. */

export interface EntryDownloadRow { readonly url: string; readonly bytes: number }
/** mode key (`developer devserver nineDragon` as 0/1) -> home -> its ordered rows */
export type EntryDownloadModes = Readonly<Record<string, Readonly<Record<string, readonly EntryDownloadRow[]>>>>;
/** The packed bank: `files` once each, `tables` of home -> file indexes, `modes` naming a table. */
export interface PackedEntryDownloads {
  readonly files: readonly (readonly [string, number])[];
  readonly tables: readonly Readonly<Record<string, readonly number[]>>[];
  readonly modes: Readonly<Record<string, number>>;
}

/** Pack the cook's per-mode rows (only `url` and `bytes` travel). */
export function packEntryDownloads(modes: EntryDownloadModes): PackedEntryDownloads {
  const files: (readonly [string, number])[] = [], fileAt = new Map<string, number>();
  const tables: Record<string, number[]>[] = [], tableAt = new Map<string, number>(), named: Record<string, number> = {};
  for (const [mode, homes] of Object.entries(modes)) {
    const table: Record<string, number[]> = {};
    for (const [home, rows] of Object.entries(homes)) {
      table[home] = rows.map(({ url, bytes }) => {
        const key = `${url} ${String(bytes)}`;
        let at = fileAt.get(key);
        if (at === undefined) { at = files.length; files.push([url, bytes]); fileAt.set(key, at); }
        return at;
      });
    }
    const key = JSON.stringify(table);
    let at = tableAt.get(key);
    if (at === undefined) { at = tables.length; tables.push(table); tableAt.set(key, at); }
    named[mode] = at;
  }
  return { files, tables, modes: named };
}

/** One mode's home rows from a packed bank, or undefined for anything malformed or absent (the caller then downloads
 *  nothing ahead, as before). */
export function unpackEntryDownloads(packed: unknown, mode: string, home: string): readonly unknown[] | undefined {
  if (typeof packed !== 'object' || packed === null) return undefined;
  const files: unknown = Reflect.get(packed, 'files'), tables: unknown = Reflect.get(packed, 'tables'), modes: unknown = Reflect.get(packed, 'modes');
  if (!Array.isArray(files) || !Array.isArray(tables) || typeof modes !== 'object' || modes === null) return undefined;
  const tableAt: unknown = Reflect.get(modes, mode);
  const table: unknown = typeof tableAt === 'number' ? tables[tableAt] : undefined;
  const indexes: unknown = typeof table === 'object' && table !== null ? Reflect.get(table, home) : undefined;
  if (!Array.isArray(indexes)) return undefined;
  return indexes.map((at: unknown) => {
    const file: unknown = typeof at === 'number' ? files[at] : undefined;
    return Array.isArray(file) ? { url: file[0], bytes: file[1] } : null;
  });
}
