// A post-generation artifact check, separate from immutable source formatting.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentNamed } from './app-build/assetHashes.ts';
import { readBootPublication, publishedBootTableSources } from './boot-publication.mjs';

/** Verify complete actual publication bytes, versions and packed payloads.
 * No constructor, generation, encoder or artifact write runs here.
 * @param {string} root */
export function verifiedBootPublicationTables(root) {
  const data = readBootPublication(root), publicRoot = realpathSync(resolve(root, 'public'));
  const file = (/** @type {string} */ url) => {
    const path = realpathSync(resolve(publicRoot, url.slice(1)));
    if (!path.startsWith(publicRoot + sep) || !statSync(path).isFile()) throw new Error(`Publication asset escapes public files: ${url}`);
    return path;
  };
  /** @type {Record<string,number>} */
  const actual = {};
  const directories = new Set();
  const walk = (/** @type {string} */ folder, /** @type {string} */ prefix) => {
    const directory = realpathSync(folder);
    if (directories.has(directory)) throw new Error(`Publication directory cycle: ${prefix}`);
    directories.add(directory);
    for (const name of readdirSync(folder)) {
      const url = `${prefix}/${name}`;
      if (url === '/assets/packs') continue;
      const path = realpathSync(resolve(folder, name));
      if (!path.startsWith(publicRoot + sep)) throw new Error(`Publication inventory escapes public: ${url}`);
      if (statSync(path).isDirectory()) walk(path, url);
      else if (!url.endsWith('.DS_Store')) actual[url] = statSync(file(url)).size;
    }
    directories.delete(directory);
  };
  walk(resolve(publicRoot, 'assets'), '/assets');
  const names = Object.keys(actual).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(data.bytes).sort())) throw new Error('Publication asset inventory differs');
  if (JSON.stringify(names.filter(name => !contentNamed(name))) !== JSON.stringify(Object.keys(data.versions).sort())) throw new Error('Publication version inventory differs');
  for (const name of names) {
    if (actual[name] !== data.bytes[name]) throw new Error(`Publication byte charge differs: ${name}`);
    if (!contentNamed(name)) {
      const hash = createHash('sha256').update(readFileSync(file(name))).digest('hex').slice(0, 8);
      if (hash !== data.versions[name]) throw new Error(`Publication content version differs: ${name}`);
    }
  }
  const parts = Object.values(data.packs).flatMap(tiers => Object.values(tiers).flatMap(tier => tier.parts));
  const packNames = [...new Set(parts.map(part => part.url))].sort();
  const actualPacks = readdirSync(resolve(publicRoot, 'assets/packs')).filter(name => name !== '.DS_Store').map(name => `/assets/packs/${name}`).sort();
  if (JSON.stringify(packNames) !== JSON.stringify(actualPacks)) throw new Error('Publication pack inventory differs');
  for (const part of parts) {
    const bytes = readFileSync(file(part.url)), hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    if (bytes.length !== part.bytes || !part.url.endsWith(`-${hash}.bin`)) throw new Error(`Publication pack identity differs: ${part.url}`);
    for (const [name, offset, length] of part.files) {
      if (!bytes.subarray(offset, offset + length).equals(readFileSync(file(name)))) throw new Error(`Publication packed payload differs: ${name}`);
    }
  }
  return publishedBootTableSources(data);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) throw new Error('Publication proof takes no arguments');
  console.log(JSON.stringify(verifiedBootPublicationTables(process.cwd())));
}
