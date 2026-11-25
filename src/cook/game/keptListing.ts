/** FAST-RELEASE FR-A21 (the planner, 11-25): the cook worker's kept bucket listing, on disk, so a restart resumes from it
 * instead of listing the whole pack bucket again before its first publish (929 s at 12:53 and 963.5 s at 13:23 UTC on the
 * box). `saveListing` writes a whole listing after each one; `appendPut` adds each PUT after it; `loadListing` reads both
 * back. A lost or stale row only costs a PUT: the worker skips a PUT only for a key written in the last GC_GRACE_MS / 2.
 * Lines are `<modified>\t<bytes>\t<key>`, under a `wildshard-cook-listing 1 <at>` header; the PUTs go in `<file>.puts`. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {dirname} from 'node:path';
import type {StoredObject} from './packStore';

const HEADER = 'wildshard-cook-listing 1 ';
/** Rows per write: a 1M-row listing never becomes one string (11-25: the cook's 4G MemoryMax). */
const CHUNK_ROWS = 4096;
const line = (row: StoredObject): string => `${row.modified}\t${row.bytes}\t${row.key}\n`;
const putsOf = (file: string): string => `${file}.puts`;

export interface SavedListing {readonly rows: Map<string, StoredObject>; readonly at: number}

/** Write `rows`, a listing that started at `at`, in place of the saved one, and start a fresh PUT journal. */
export function saveListing(file: string, at: number, rows: Iterable<StoredObject>): void {
  mkdirSync(dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.tmp`, fd = openSync(temp, 'w');
  try {
    writeSync(fd, `${HEADER}${at}\n`);
    let chunk: string[] = [];
    for (const row of rows) {
      chunk.push(line(row));
      if (chunk.length === CHUNK_ROWS) { writeSync(fd, chunk.join('')); chunk = []; }
    }
    if (chunk.length > 0) writeSync(fd, chunk.join(''));
  } finally { closeSync(fd); }
  renameSync(temp, file);
  writeFileSync(putsOf(file), '');
}

/** Note one PUT after the saved listing. */
export function appendPut(file: string, row: StoredObject): void {
  appendFileSync(putsOf(file), line(row));
}

/** Each well-formed line of `bytes` from `start`. A key is decoded from its own bytes, so no row keeps the file's text
 *  alive (the FR-A16 lesson: a regex capture kept its whole listing page). */
function eachRow(bytes: Buffer, start: number, take: (row: StoredObject) => void): void {
  for (let at = start; at < bytes.length;) {
    let end = bytes.indexOf(10, at);
    if (end === -1) end = bytes.length;
    const first = bytes.indexOf(9, at), second = first === -1 || first >= end ? -1 : bytes.indexOf(9, first + 1);
    if (second !== -1 && second < end && second + 1 < end) {
      const modified = Number(bytes.toString('latin1', at, first)), size = Number(bytes.toString('latin1', first + 1, second));
      if (Number.isFinite(modified) && Number.isInteger(size) && size >= 0) take({key: bytes.toString('utf8', second + 1, end), bytes: size, modified});
    }
    at = end + 1;
  }
}

/** The saved listing with every PUT since, or undefined when there is none or it can't be read. */
export function loadListing(file: string): SavedListing | undefined {
  let bytes: Buffer;
  try { bytes = readFileSync(file); } catch { return undefined; }
  const end = bytes.indexOf(10), head = end === -1 ? '' : bytes.toString('latin1', 0, end);
  if (!head.startsWith(HEADER)) return undefined;
  const at = Number(head.slice(HEADER.length));
  if (!Number.isFinite(at)) return undefined;
  const rows = new Map<string, StoredObject>(), take = (row: StoredObject): void => { rows.set(row.key, row); };
  eachRow(bytes, end + 1, take);
  try { eachRow(readFileSync(putsOf(file)), 0, take); } catch { /* no PUT since the listing */ }
  return {rows, at};
}
