// J171, Q41: what a channel serves, as promotion wrote it to R2. The game server reads this and cooked packs and nothing else, so it boots
// with `api-server` down and no bad catalogue row reaches a player until something signs it.
// oxlint-disable-next-line import/no-nodejs-modules -- Ed25519, with a key only the promoter holds.
import { createPublicKey, verify } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- A `file:` release is a local run's.
import { readFile } from 'node:fs/promises';
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { ReleaseSchema, SignedSchema, type ReleaseFile } from '../../../shared/host/releaseRows';

/** How often the server looks, in ms: as the cook worker does, outbound, so the VPS opens no port (J175, Q91). */
const POLL_MS = 60_000;
/** A look that hangs would stop every later look: one minute's poll is the most it may take. */
const FETCH_MS = 30_000;
/** A signed file's text as what it says. It throws on a bad signature, before a byte of the body is believed. `publicKey` is SPKI DER in hex, and the signature is hex.
 *  The release file and SA33's placement file share it, each under its own key. */
export function readSigned<T>(text: string, publicKey: string, schema: v.GenericSchema<T>, what: string): T {
  const signed = v.parse(SignedSchema, JSON.parse(text)), key = createPublicKey({ key: Buffer.from(publicKey, 'hex'), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(signed.body), key, Buffer.from(signed.signature, 'hex'))) throw new Error(`A ${what} has a bad signature`);
  return v.parse(schema, JSON.parse(signed.body));
}
/** A signed file's text at `url`, an `https:` bucket or a `file:` path. */
export async function fetchSignedText(url: string, what: string): Promise<string> {
  if (url.startsWith('file:')) return readFile(new URL(url), 'utf8');
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_MS) });
  if (!response.ok) throw new Error(`No ${what} at ${url}: ${String(response.status)}`);
  return response.text();
}
/** The release file's text as what it says. */
export function readReleaseFile(text: string, publicKey: string): ReleaseFile { return readSigned(text, publicKey, ReleaseSchema, 'release file'); }
/** The release file at `url`, an `https:` bucket or a `file:` path. */
export async function fetchReleaseFile(url: string, publicKey: string): Promise<ReleaseFile> { return readReleaseFile(await fetchSignedText(url, 'release file'), publicKey); }

/** Boot from the release whose bundle passed the pull. Remote metadata alone cannot change its epoch.
 * A direct local boot without a kept file may use the signed file for its build and configured channel. */
export function servingRelease(build: string, channel: string, newest: ReleaseFile | null, kept: ReleaseFile | null, installed = false): ReleaseFile {
  if (kept?.engineBuild === build && kept.channel === channel) return kept;
  if (newest?.engineBuild === build && newest.channel === channel && kept === null && !installed) return newest;
  throw new Error(`No installed release for ${build} on ${channel}`);
}

/** How a watch is built. */
export interface ReleaseWatchOptions {
  readonly read: () => Promise<ReleaseFile>;
  /** What this process is serving. */
  readonly serving: ReleaseFile;
  /** A newer release, once. Packs reach disk here, then the grace starts. A throw is told to `failed`, and the next look tries again. */
  readonly changed: (next: ReleaseFile) => Promise<void>;
  /** A look that failed. The server plays on with what it has. */
  readonly failed: (error: unknown) => void;
  readonly everyMs?: number;
  /** A release cannot begin its grace without every cell this process will open. */
  readonly cells?: readonly string[];
}
/** J174's one trigger, for a build or a flip: a release newer than the one served. */
export class ReleaseWatch {
  private readonly options: ReleaseWatchOptions;
  private readonly scope = new Scope('dedicated.release');
  private looking = false;
  private done = false;
  constructor(options: ReleaseWatchOptions) {
    this.options = options;
    this.scope.interval(options.everyMs ?? POLL_MS, () => { void this.look(); });
  }
  /** One look. An older or equal file changes nothing. */
  async look(): Promise<void> {
    if (this.looking || this.done) return;
    this.looking = true;
    try {
      const next = await this.options.read();
      if (next.channel !== this.options.serving.channel) throw new Error(`A ${next.channel} release on a ${this.options.serving.channel} server`);
      const named = new Set(next.shards.map(row => row.slug));
      for (const cell of this.options.cells ?? []) if (!named.has(cell)) throw new Error(`The release has no ${cell}`);
      if (next.serial > this.options.serving.serial) { await this.options.changed(next); this.done = true; this.scope.dispose(); }
    } catch (error) { this.options.failed(error); } finally { this.looking = false; }
  }
  dispose(): void { this.scope.dispose(); }
}
