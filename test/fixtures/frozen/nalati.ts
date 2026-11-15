import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type FrozenFile = { name: string; bytes: number; sha256: string };
type FrozenManifest = { sourceCommit: string; exporter: string; files: FrozenFile[] };

const directory = new URL('./nalati/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('./nalati/manifest.json', import.meta.url), 'utf8')) as FrozenManifest;
if (!/^[a-f0-9]{40}$/u.test(manifest.sourceCommit) || manifest.exporter !== 'scripts/export-ci21-frozen.mjs') {
  throw new Error('Invalid CI21 Nalati frozen-fixture manifest');
}
const entries = new Map(manifest.files.map(file => [file.name, file]));

/** Reads an immutable CI21-H2 fixture without reaching into a shard checkout. */
export function frozenNalatiBytes(name: string): Uint8Array {
  const entry = entries.get(name);
  if (entry === undefined || !/^[a-z0-9][a-z0-9-]*\.(?:bin|json|wasm)$/u.test(name)
    || !Number.isSafeInteger(entry.bytes) || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
    throw new Error(`Unknown CI21 Nalati frozen fixture: ${name}`);
  }
  const bytes = new Uint8Array(readFileSync(new URL(name, directory)));
  if (bytes.byteLength !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`CI21 Nalati frozen fixture differs: ${name}`);
  }
  return bytes;
}

/** Parses a frozen JSON fixture after its hash and declared byte size are checked. */
export function frozenNalatiJson(name: string): unknown {
  if (!name.endsWith('.json')) throw new Error(`CI21 Nalati fixture is not JSON: ${name}`);
  return JSON.parse(new TextDecoder().decode(frozenNalatiBytes(name)));
}
