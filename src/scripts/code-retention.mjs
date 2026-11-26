// FM7: sign the exact graphs the page actually carries, never a guessed five-release history.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as v from 'valibot';
import { CodeRetentionSchema } from '../shared/host/codeRetention.ts';
import { KEEP_PROMOTED } from './app-build/previousDeploy.mjs';

/** Sign only after the carry step has copied the actual kept files.
 * @param {{directory: string, channel: 'production'|'staging'|'preview', privateKey: string, publicKey: string, now?: number}} options */
export function signCodeRetention({ directory, channel, privateKey, publicKey, now = Date.now() }) {
  const manifest = JSON.parse(readFileSync(join(directory, 'deploy-chunks.json'), 'utf8'));
  if (manifest.format !== 2 || !Array.isArray(manifest.builds) || manifest.builds.length > KEEP_PROMOTED) throw new Error('Invalid retained-code graph');
  const metadata = v.parse(CodeRetentionSchema, { purpose: 'code-retention', channel,
    engineBuild: JSON.parse(readFileSync(join(directory, 'version.json'), 'utf8')).build,
    keptBuilds: manifest.builds.map((/** @type {{build: string}} */ graph) => graph.build), issuedAt: now });
  for (const graph of manifest.builds) {
    if (!Array.isArray(graph.files) || graph.files.length === 0) throw new Error('An empty code graph is not kept code');
    for (const file of graph.files) {
      if (typeof file.path !== 'string' || !/^(?:assets|builds|b)\/[a-zA-Z0-9_./-]+$/u.test(file.path) || file.path.split('/').some((/** @type {string} */ part) => part === '.' || part === '..' || part === '')) throw new Error('Invalid retained-code path');
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || statSync(join(directory, file.path)).size !== file.bytes) throw new Error('A retained-code file is missing or changed');
    }
  }
  return signRetention(metadata, privateKey, publicKey);
}
/** Sign metadata the schema admits with the release trust root (the page publisher here; the online rig's fixture key in FM5b4).
 * @param {unknown} metadata @param {string} privateKey @param {string} publicKey */
export function signRetention(metadata, privateKey, publicKey) {
  const checked = v.parse(CodeRetentionSchema, metadata);
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519' || createPublicKey(key).export({type: 'spki', format: 'der'}).toString('hex') !== publicKey) throw new Error('Code-retention signing key differs from the release trust root');
  const body = JSON.stringify(checked);
  return JSON.stringify({ body, signature: sign(null, Buffer.from(body), key).toString('hex') });
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory = '', channel = ''] = process.argv.slice(2);
  if (directory === '' || !['staging', 'production', 'preview'].includes(channel)) throw new Error('code-retention <page dist> <channel>');
  const text = signCodeRetention({ directory, channel: /** @type {'production'|'staging'|'preview'} */ (channel), privateKey: process.env.E7_RELEASE_SIGNING_KEY ?? '', publicKey: process.env.E7_RELEASE_PUBLIC_KEY ?? '' });
  writeFileSync(join(directory, 'code-retention.json'), text);
  const headers = join(directory, '_headers');
  writeFileSync(headers, `${existsSync(headers) ? readFileSync(headers, 'utf8') : ''}\n/code-retention.json\n  Cache-Control: no-store\n`);
}
