#!/usr/bin/env node
// Meta SHARD-PUBLISH-ACTIONS SP6 (J369, J371): pin one shard revision a publish just committed, as the hand bumps did
// (engine fafee64e): its row in test/pins/shardfiles.json and in the pinned catalogue document, then the staging
// snapshot by refresh. Only that slug's pin moves: a full `pins.ts refresh` would pull every other pin to its live head
// and drop the staging revisions pinned by hand. Node built-ins only; .github/workflows/shard-pin.yml runs it.
//
//   node scripts/pin-shard.ts <slug> <revision> <hash> [staging|prod]
//
// It refuses unless the API's channel document names exactly that revision and hash for the slug, and a slug engine
// never pinned (a first pin is a reviewed `pins.ts refresh`, DEL9).
import { agentFetch as fetch } from './agent-requests.mjs';
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {refreshStaging} from './pins-staging.ts';

interface Pin {slug: string; revision: number; hash: string; bytes: number}
interface PinFile {api: string; shards: Pin[]}
interface DocumentRow {slug: string; name?: string; revision: number; hash: string}
interface PinnedDocument {shards: DocumentRow[]}

const {WILDSHARD_API: API = 'https://api.wildshard.io'} = process.env;
const PINS = 'test/pins/shardfiles.json', CATALOGUE = 'test/pins/catalogue.json';
const HASH = /^[a-f0-9]{64}$/u, SLUG = /^[a-z0-9-]+$/u, REVISION = /^[1-9][0-9]*$/u;
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The pins and the pinned document with `slug` moved to `pin`; throws for a slug neither names. */
export function movePin(pins: PinFile, document: PinnedDocument, pin: Pin): {pins: PinFile; document: PinnedDocument} {
  const at = pins.shards.findIndex(row => row.slug === pin.slug), doc = document.shards.findIndex(row => row.slug === pin.slug);
  if (at === -1 || doc === -1) throw new Error(`${pin.slug} has no pin to move (${PINS} or ${CATALOGUE}): a first pin is a reviewed pins.ts refresh`);
  const held = pins.shards[at];
  if (held !== undefined && held.revision > pin.revision) throw new Error(`${pin.slug}: engine pins revision ${held.revision}, newer than ${pin.revision}`);
  return {
    pins: {...pins, shards: pins.shards.map((row, index) => index === at ? pin : row)},
    document: {...document, shards: document.shards.map((row, index) => index === doc ? {...row, revision: pin.revision, hash: pin.hash} : row)},
  };
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function main([slug = '', revisionText = '', hash = '', channel = 'staging']: readonly string[]): Promise<void> {
  const revision = Number(revisionText);
  if (!SLUG.test(slug) || !REVISION.test(revisionText) || !Number.isSafeInteger(revision) || revision < 1 || !HASH.test(hash) || !['staging', 'prod'].includes(channel)) {
    throw new Error('usage: pin-shard.ts <slug> <revision> <sha256> [staging|prod]');
  }
  // A prod upload moves staging too (J301), so staging names the revision either way.
  const [document, listing] = await Promise.all([getJson('/api/catalogue.json?channel=staging'), getJson('/api/shardfiles')]);
  const row = (document as PinnedDocument).shards.find(shard => shard.slug === slug);
  if (row?.revision !== revision || row.hash !== hash) {
    throw new Error(`staging names ${slug} ${row === undefined ? 'nowhere' : `rev ${row.revision} ${row.hash.slice(0, 8)}`}, not rev ${revision} ${hash.slice(0, 8)}`);
  }
  const bytes = (listing as {shardfiles: {hash: string; bytes: number}[]}).shardfiles.find(file => file.hash === hash)?.bytes;
  if (bytes === undefined || bytes <= 0) throw new Error(`GET /api/shardfiles does not list ${hash.slice(0, 8)}`);
  const moved = movePin(JSON.parse(readFileSync(PINS, 'utf8')) as PinFile, JSON.parse(readFileSync(CATALOGUE, 'utf8')) as PinnedDocument, {slug, revision, hash, bytes});
  writeFileSync(PINS, json(moved.pins));
  writeFileSync(CATALOGUE, json(moved.document));
  await refreshStaging(API);
  console.log(`pinned ${slug} rev ${revision} ${hash.slice(0, 8)} (${bytes} bytes) from ${channel}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
