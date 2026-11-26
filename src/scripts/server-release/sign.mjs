// E7.2c: the same signed body consumed by the dedicated server and WebCrypto.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as v from 'valibot';
import { ReleaseSchema, SignedSchema } from '../../shared/host/releaseRows.ts';
import { servedSlug } from './served-slug.mjs';

export { DEFAULT_SERVER_SHARDS, servedSlug } from './served-slug.mjs';

/** @typedef {import('../../shared/host/releaseRows.ts').ReleaseFile} ReleaseFile */
export const COMMIT = /^[0-9a-f]{40}$/u;

/** Online publications name their immutable bundle and socket; preview is a signed solo deployment.
 * @param {unknown} value @returns {ReleaseFile} */
export function publication(value) {
  const row = v.parse(ReleaseSchema, value);
  if (!Number.isSafeInteger(row.serial) || row.serial < 1 || !COMMIT.test(row.engineBuild)
    || !Number.isSafeInteger(row.saveEpoch) || row.saveEpoch < 1 || row.shards.length === 0
    || row.shards.some(shard => !/^[a-z0-9_-]+$/u.test(shard.slug) || !Number.isSafeInteger(shard.revision))
    || new Set(row.shards.map(shard => shard.slug)).size !== row.shards.length) throw new Error('Invalid release publication');
  if (row.channel === 'preview') {
    if (row.socket !== undefined || row.bundle !== undefined) throw new Error('Preview publication must be solo');
    return row;
  }
  if (row.bundle === undefined || !/^[\w][\w.+-]*\/[\w][\w.+-]*\.tar\.gz$/u.test(row.bundle.name)
    || row.socket === undefined) throw new Error('Invalid server publication');
  const socket = new URL(row.socket);
  if (socket.protocol !== 'wss:' || socket.username !== '' || socket.password !== '' || socket.hash !== '') throw new Error('A public wss socket is required');
  return row;
}

/** Derive only the public SPKI. Never return or log private material.
 * @param {string} pem @returns {string} */
export function releasePublicKey(pem) {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('E7_RELEASE_SIGNING_KEY must be Ed25519 PKCS8 PEM');
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('hex');
}

/** @param {unknown} value @param {string} pem @returns {string} */
export function signRelease(value, pem) {
  const body = JSON.stringify(publication(value));
  releasePublicKey(pem);
  return JSON.stringify({ body, signature: sign(null, Buffer.from(body), createPrivateKey(pem)).toString('hex') });
}

/** Authenticate the old channel before using its serial or commit.
 * @param {string} text @param {string} publicKey @returns {ReleaseFile} */
export function readPublication(text, publicKey) {
  const signed = v.parse(SignedSchema, JSON.parse(text));
  if (!/^(?:[0-9a-f]{2})+$/iu.test(publicKey)) throw new Error('Invalid release public key');
  const key = createPublicKey({ key: Buffer.from(publicKey, 'hex'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(signed.body), key, Buffer.from(signed.signature, 'hex'))) throw new Error('Bad channel release signature');
  return publication(JSON.parse(signed.body));
}

/** C25: the name is relative to GitHub releases/download, including the tag.
 * @param {string} archive @param {string} tag @returns {{name: string, sha256: string}} */
export function bundleDescriptor(archive, tag) {
  return { name: `${tag}/${basename(archive)}`, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
}

/** The release's shards, by the name the server reads them under; a variable may give a pin's slug or its folder.
 * @param {unknown} pins @param {string} names @returns {ReleaseFile['shards']} */
export function releaseShards(pins, names) {
  const upload = v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)));
  // Fix preview PV2: a pin that names its raw shard version (R2 layout RL12) carries it into the release, for preview's zone table.
  const head = v.object({slug: v.string(), uploadNumber: upload, revision: upload, shardVersion: v.exactOptional(v.string())});
  const rows = v.parse(v.object({shards: v.array(head)}), pins).shards;
  const selected = names.split(',').map(name => name.trim()).filter(Boolean).map(servedSlug);
  if (selected.length === 0 || new Set(selected).size !== selected.length) throw new Error('E7_SERVER_SHARDS must name unique pinned shards');
  return selected.map(slug => {
    const row = rows.find(shard => servedSlug(shard.slug) === slug);
    const uploadNumber = row?.uploadNumber ?? row?.revision;
    if (uploadNumber === undefined) throw new Error(`No pinned uploadNumber for ${slug}`);
    // Deployed readers of the signed release still use the old field.
    return {slug, revision: uploadNumber, ...(row?.shardVersion === undefined ? {} : {shardVersion: row.shardVersion})};
  });
}
