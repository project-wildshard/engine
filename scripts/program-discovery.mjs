import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as v from 'valibot';
import { readBuiltShardfile } from './built-product.mjs';
import { discoveryFormat, outputFormat } from './node-format.mjs';
import { encodeCanonicalJson } from '@wildshard/engine/host/immutable';

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Inspect admitted binding slots without loading any generator or product builder.
 * @param {unknown} metadata */
export function usesProgramDiscovery(metadata) {
  if (!plain(metadata) || !plain(metadata.bindings)) return false;
  const values = metadata.bindings;
  /** @param {unknown} value */
  const program = value => plain(value) && value.program === true;
  const boot = values.boot;
  return ['budgets', 'navigation', 'mapPalette', 'poses', 'audioCues', 'ktx2'].some(key => program(values[key]))
    || plain(boot) && ['files', 'sources', 'lateReads', 'explore'].some(key => program(boot[key]));
}

/** Read only current product metadata, bound to its exact index and canonical values.
 * @param {string} root @param {string} name
 * @param {{cacheRoot?:string,env?:NodeJS.ProcessEnv}} [options] */
export function readProgramDiscovery(root, name, options = {}) {
  const folder = readBuiltShardfile(root, name, options);
  const read = (file, limit) => {
    const path = resolve(folder, file);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > limit) throw new Error(`${name}: discovery metadata exceeds bounds`);
    return readFileSync(path);
  };
  const envelope = read('shard.json', 32 * 1024 * 1024);
  const index = outputFormat.parseOutputIndex(JSON.parse(envelope.toString('utf8')));
  const receipt = v.parse(v.object({ indexHash: v.string(), discovery: v.strictObject({ hash: v.string(), values: v.unknown() }) }),
    JSON.parse(read('validation.json', 2 * 1024 * 1024).toString('utf8')));
  if (index.identity.slug !== name || receipt.indexHash !== createHash('sha256').update(envelope).digest('hex')) throw new Error(`${name}: discovery index receipt differs`);
  const values = discoveryFormat.parseDiscoveryValues(receipt.discovery.values);
  if (receipt.discovery.hash !== createHash('sha256').update(encodeCanonicalJson(values)).digest('hex')) throw new Error(`${name}: discovery values receipt differs`);
  return values;
}
