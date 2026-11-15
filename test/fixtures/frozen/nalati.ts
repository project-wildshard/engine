import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ReturnProgram } from '../../../src/shared/game/population/returnProgram';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import type { Scope } from '../../../src/shared/engine/app/scope';
import { looseObject, parse, string } from 'valibot';

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
  if (entry === undefined || !/^[A-Za-z0-9][A-Za-z0-9-]*\.(?:bin|json|wasm)$/u.test(name)
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

const frozenAdmission = frozenNalatiJson('nalati-admission-original.json');
if (typeof frozenAdmission !== 'object' || frozenAdmission === null) throw new Error('CI21 frozen admission must be an object');
const admission = parse(ReturnProgramSchema, Object.fromEntries(Object.entries(frozenAdmission).filter(([name]) => name !== 'compiled')));
const admissionV2 = admission.v2;
if (admissionV2 === undefined) throw new Error('CI21 frozen admission must declare ABI2');
const admissionArtifact = admissionV2.artifact.hash;
const admissionScript = parse(looseObject({ module: string() }), admission.script);
const admissionWitness = admissionScript.module.slice('blobs/wasm/'.length, -'.wasm'.length);
export const frozenAdmissionAssets = new Map([
  [admissionArtifact, frozenNalatiBytes('nalati-admission-original.wasm')],
  [admissionWitness, frozenNalatiBytes('nalati-admission-witness-original.bin')],
]);
export const frozenAdmissionModules = [{
  id: 'ci21.frozen.admission', module: `blobs/wasm/${admissionArtifact}.wasm`, side: 'sim' as const, abi: 2 as const,
  lane: admissionV2.artifact.lane, pages: admissionV2.artifact.pages, ioBytes: admissionV2.artifact.ioBytes,
  compilerRevision: admissionV2.artifact.compilerRevision, admissionRevision: admissionV2.artifact.admissionRevision,
}];

/** Lends the pinned ABI2 admission guest to a test's actual owning scope. */
export function lendFrozenNalatiAdmission(owner: Scope): void {
  ReturnProgram.lendModules(owner, frozenAdmissionAssets, frozenAdmissionModules);
}

/** Reuses the pinned admission guest where a compact public stealth envelope is enough. */
export const frozenAdmissionProgram = admission;

export function frozenAdmissionNative(host: import('../../../src/server/engine/sim').SimHost): ReturnProgram {
  lendFrozenNalatiAdmission(host.scope);
  return ReturnProgram.native(host, frozenAdmissionProgram);
}
