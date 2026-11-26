#!/usr/bin/env node
// Meta SHARD-PUBLISH-ACTIONS SP6 (J369, J371): pin one shard revision a publish just committed, as the hand bumps did
// (engine fafee64e): its row in test/pins/shardfiles.json and in the pinned catalogue document, then the staging
// snapshot by refresh. Only that slug's pin moves: a full `pins.ts refresh` would pull every other pin to its live head
// and drop the staging revisions pinned by hand. Node built-ins only; .github/workflows/shard-pin.yml runs it.
//
//   node src/scripts/pin-shard.ts <slug> <revision> <hash> [staging|prod] [--first]
//   node src/scripts/pin-shard.ts --drop <slug...>  remove pins after the reviewed catalogue removes them and no test
//                                               names them (NB10, pin-test-names.ts)
//
// It refuses unless the API's channel document names exactly that revision and hash for the slug, and a slug engine
// never pinned (a first pin is a reviewed `pins.ts refresh`, DEL9) unless `--first` asks for one: meta MOSSGATE-ZONE MZ26,
// a staging-only shard (production `live: null`, so `pins.ts refresh` skips it) joins the preview pins under staging's name.
import { agentFetch as fetch } from './agent-requests.mjs';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {refreshStaging} from './pins-staging.ts';
import {documentSlugs} from './pins-catalogue.ts';
import {assertTestsDropped} from './pin-test-names.ts';

interface Pin {slug: string; revision: number; hash: string; bytes: number}
interface PinFile {api: string; shards: Pin[]}
interface DocumentRow {slug: string; name?: string; revision: number; hash: string}
interface PinnedDocument {shards: DocumentRow[]}

const {WILDSHARD_API: API = 'https://api.wildshard.io'} = process.env;
const PINS = 'test/pins/shardfiles.json', CATALOGUE = 'test/pins/catalogue.json', SAVES = 'test/pins/saves';
const PIANO_MANIFEST = 'public/assets/music/piano/music.json';
const HASH = /^[a-f0-9]{64}$/u, SLUG = /^[a-z0-9-]+$/u, REVISION = /^[1-9][0-9]*$/u;
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The pins and the pinned document with `slug` moved to `pin`; throws for a slug neither names, unless `first` names it,
 *  which appends it to both. */
export function movePin(pins: PinFile, document: PinnedDocument, pin: Pin, first?: {name: string}): {pins: PinFile; document: PinnedDocument} {
  const at = pins.shards.findIndex(row => row.slug === pin.slug), doc = document.shards.findIndex(row => row.slug === pin.slug);
  if (first !== undefined && at === -1 && doc === -1) {
    return {pins: {...pins, shards: [...pins.shards, pin]}, document: {...document, shards: [...document.shards, {slug: pin.slug, name: first.name, revision: pin.revision, hash: pin.hash}]}};
  }
  if (at === -1 || doc === -1) throw new Error(`${pin.slug} has no pin to move (${PINS} or ${CATALOGUE}): a first pin is a reviewed pins.ts refresh`);
  const held = pins.shards[at];
  if (held !== undefined && held.revision > pin.revision) throw new Error(`${pin.slug}: engine pins revision ${held.revision}, newer than ${pin.revision}`);
  return {
    pins: {...pins, shards: pins.shards.map((row, index) => index === at ? pin : row)},
    document: {...document, shards: document.shards.map((row, index) => index === doc ? {...row, revision: pin.revision, hash: pin.hash} : row)},
  };
}

/** Meta SHARD-COMPAT NB10 (audit B12): a released save fixture names the pin it resumes on (`pin`) or the pin whose
 *  changed level refuses it (`refused`), and released-save-play checks that name against the slug's pin, so a re-pin
 *  moved it by hand in a follow-up commit (Nine r6 `32236ee94`, Pine `b93a7c5e8`, Nalati r6 `211ba9d49`). The pin commit
 *  moves it: `refused` stays a refusal on the new pin, otherwise `pin` names it. The land's released-save-play run is the
 *  proof that the save still resumes; a pin whose level refuses it goes red there and the lane writes `refused`. */
type SaveFixture = Readonly<{refused?: unknown; shardfile?: unknown; pin?: unknown; [key: string]: unknown}>;
export function moveSavePin(save: SaveFixture, hash: string): Record<string, unknown> {
  if (typeof save.refused === 'string') return {...save, refused: hash};
  if (save.shardfile === hash) {
    const {pin: _pin, ...made} = save;
    return made;
  }
  return {...save, pin: hash};
}

/** Meta SHARD-COMPAT NB10 (audit B16): engine's piano manifest names the recordings a pin publishes (Driftwood's
 *  `island-*`, Pine's `pine-*`) by their bytes, so a re-pin whose encoder hashed them differently left it naming files
 *  no pin mounts: engine main red, then a follow-up commit (Driftwood r5 `4a72bba51`, Pine r6 `57a386863`, Driftwood r8
 *  `9166106aa`). The pin commit renames each manifest file to the one the new product mounts with the same stem
 *  (`island-calm`), everywhere the manifest names it (slots, stings, provenance). Files the product does not mount stay. */
const PIANO = '/assets/music/piano/', STEM = /^(.+)-[a-f0-9]{8}\.m4a$/u;
export function movePianoStems(manifest: string, mounts: readonly string[]): {manifest: string; moved: string[]} {
  const byStem = new Map<string, string>();
  for (const url of mounts) {
    if (!url.startsWith(PIANO)) continue;
    const name = url.slice(PIANO.length), stem = STEM.exec(name)?.[1];
    if (stem !== undefined && !name.includes('/')) byStem.set(stem, name);
  }
  const moved: string[] = [];
  const text = manifest.replaceAll(/"([a-z0-9-]+-[a-f0-9]{8}\.m4a)"/gu, (whole, name: string) => {
    const next = byStem.get(STEM.exec(name)?.[1] ?? '');
    if (next === undefined || next === name) return whole;
    if (!moved.includes(`${name} -> ${next}`)) moved.push(`${name} -> ${next}`);
    return `"${next}"`;
  });
  return {manifest: text, moved};
}

/** The named entries of a ustar archive (a shard file tarball), with pax and GNU long names. Node built-ins only. */
export function tarEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>(), text = (from: number, to: number): string => new TextDecoder().decode(bytes.subarray(from, to)).replace(/\0.*$/su, '');
  let at = 0, longName: string | undefined;
  while (at + 512 <= bytes.length) {
    const header = bytes.subarray(at, at + 512);
    if (header.every(byte => byte === 0)) break;
    const sizeField = header.subarray(124, 136), size = (sizeField[0] ?? 0) & 0x80
      ? sizeField.subarray(1).reduce((sum, byte) => sum * 256 + byte, 0)
      : Number.parseInt(text(at + 124, at + 136).trim() || '0', 8);
    const type = String.fromCodePoint(header[156] ?? 0), body = bytes.subarray(at + 512, at + 512 + size);
    const prefix = text(at + 345, at + 500), name = longName ?? (prefix === '' ? text(at, at + 100) : `${prefix}/${text(at, at + 100)}`);
    longName = undefined;
    if (type === 'L') longName = new TextDecoder().decode(body).replace(/\0.*$/su, '');
    else if (type === 'x') longName = /(?:^|\n)\d+ path=([^\n]*)\n/u.exec(new TextDecoder().decode(body))?.[1];
    else if (type === '0' || type === '\0') out.set(name.replace(/^\.\//u, ''), body);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** The URLs a product's cook mounts, from its tarball's `cook.json`. */
export function productMounts(tarball: Uint8Array): string[] {
  const cook = tarEntries(tarball).get('cook.json');
  if (cook === undefined) return [];
  const rows = (JSON.parse(new TextDecoder().decode(cook)) as {mounts?: {url?: unknown}[]}).mounts ?? [];
  return rows.flatMap(row => typeof row.url === 'string' ? [row.url] : []);
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === '--drop') {
    const names = argv.slice(1);
    if (names.length === 0 || names.some(name => !SLUG.test(name))) throw new Error('usage: pin-shard.ts --drop <slug...>');
    const pins = JSON.parse(readFileSync(PINS, 'utf8')) as PinFile;
    const catalogue = new Set(documentSlugs(JSON.parse(readFileSync(CATALOGUE, 'utf8'))));
    for (const name of names) {
      if (catalogue.has(name) || !pins.shards.some(row => row.slug === name)) {
        throw new Error(`${name}: must be pinned and absent from the reviewed catalogue before --drop`);
      }
    }
    assertTestsDropped(names);
    writeFileSync(PINS, json({...pins, shards: pins.shards.filter(row => !names.includes(row.slug))}));
    console.log(`Removed grid pins for ${names.join(', ')}`);
    return;
  }
  const first = argv.includes('--first');
  const [slug = '', revisionText = '', hash = '', channel = 'staging'] = argv.filter(arg => arg !== '--first');
  const revision = Number(revisionText);
  if (!SLUG.test(slug) || !REVISION.test(revisionText) || !Number.isSafeInteger(revision) || revision < 1 || !HASH.test(hash) || !['staging', 'prod'].includes(channel)) {
    throw new Error('usage: pin-shard.ts <slug> <revision> <sha256> [staging|prod] [--first]');
  }
  // A prod upload moves staging too (J301), so staging names the revision either way.
  const [document, listing] = await Promise.all([getJson('/api/catalogue.json?channel=staging'), getJson('/api/shardfiles')]);
  const row = (document as PinnedDocument).shards.find(shard => shard.slug === slug);
  if (row?.revision !== revision || row.hash !== hash) {
    throw new Error(`staging names ${slug} ${row === undefined ? 'nowhere' : `rev ${row.revision} ${row.hash.slice(0, 8)}`}, not rev ${revision} ${hash.slice(0, 8)}`);
  }
  const bytes = (listing as {shardfiles: {hash: string; bytes: number}[]}).shardfiles.find(file => file.hash === hash)?.bytes;
  if (bytes === undefined || bytes <= 0) throw new Error(`GET /api/shardfiles does not list ${hash.slice(0, 8)}`);
  const moved = movePin(JSON.parse(readFileSync(PINS, 'utf8')) as PinFile, JSON.parse(readFileSync(CATALOGUE, 'utf8')) as PinnedDocument, {slug, revision, hash, bytes}, first ? {name: row.name ?? slug} : undefined);
  writeFileSync(PINS, json(moved.pins));
  writeFileSync(CATALOGUE, json(moved.document));
  const save = `${SAVES}/${slug}.json`;
  if (existsSync(save)) writeFileSync(save, json(moveSavePin(JSON.parse(readFileSync(save, 'utf8')) as Record<string, unknown>, hash)));
  const tarball = await fetch(`${API}/api/shardfiles/${hash}`);
  if (!tarball.ok) throw new Error(`GET /api/shardfiles/${hash.slice(0, 8)}: HTTP ${tarball.status}`);
  const piano = movePianoStems(readFileSync(PIANO_MANIFEST, 'utf8'), productMounts(new Uint8Array(await tarball.arrayBuffer())));
  if (piano.moved.length > 0) {
    writeFileSync(PIANO_MANIFEST, piano.manifest);
    console.log(`piano manifest follows the pin: ${piano.moved.join(', ')}`);
  }
  await refreshStaging(API);
  console.log(`pinned ${slug} rev ${revision} ${hash.slice(0, 8)} (${bytes} bytes) from ${channel}${first ? ' (first pin)' : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
