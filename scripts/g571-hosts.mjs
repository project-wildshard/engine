// Credit only exact G571 entries or explicitly tagged Jake-picked hosts.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { onDisk } from './format-package.mjs';
import { unsortedPath } from '../lint/layer-exports.mjs';

/** Decisions name a host however it was tagged then, and a retag moves the file, not the approval. @param {string} root @param {string} path */
function hostFile(root, path) {
  if (existsSync(onDisk(root, path))) return path;
  const sided = ['client', 'cook', 'server', 'shared'].map(side => unsortedPath(path).replace(/^src\/(engine|game)\//u, `src/$1/${side}/`));
  return sided.find(candidate => existsSync(onDisk(root, candidate))) ?? path;
}

/** Read exact selectors from G571 entries or unconditional G599-G603 or exact G614/G665/G667/G677 entries
 * tagged "Jake-approved host:". Only G599-G603 may include a row id.
 * Missing documentation, ordinary prose and conditional approval grant no credit.
 * A binding never approves its module; imports retain their own attribution.
 * @param {string} root @returns {Map<string,Set<string>|null>} */
export function g571HostApprovals(root) {
  const file = resolve(root, 'docs/HOST-BAR.md');
  /** @type {Map<string,Set<string>|null>} */
  const result = new Map();
  if (!existsSync(file)) return result;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const legacy = /^- G571\b/u.test(line);
    const picked = /^- (?:G(?:599|600|601|602|603)(?: [A-Z]\d+[a-z]?)?|G(?:614|665|667|677)) Jake-approved host:/u.test(line);
    if (!legacy && (!picked || /\b(?:conditional(?:ly)?|condition|until|unless|if)\b/iu.test(line))) continue;
    for (const match of line.matchAll(/`((?:engine|game|sdk|sharddev|format)\/[A-Za-z0-9_./-]+)(?:#([A-Za-z_$][\w$]*))?`/gu)) {
      /** @type {readonly (string|undefined)[]} */
      const captures = match;
      const module = captures[1], name = captures[2];
      if (module === undefined) throw new Error('Invalid G571 host selector');
      if (module.split('/').some(part => part === '.' || part === '..' || part === '') || module.endsWith('.ts')) throw new Error(`Invalid G571 host selector: ${module}`);
      const path = hostFile(root, `src/${module}.ts`);
      if (!existsSync(onDisk(root, path))) { console.warn(`Missing G571 host: ${path}; approval skipped`); continue; }
      if (name === undefined) {
        if (result.has(path)) throw new Error(`Overlapping G571 host: ${path}`);
        result.set(path, null);
      } else {
        if (result.has(path) && result.get(path) === null) throw new Error(`Overlapping G571 host: ${path}`);
        const names = result.get(path) ?? new Set();
        if (names.has(name)) throw new Error(`Duplicate G571 host: ${path}#${name}`);
        names.add(name); result.set(path, names);
      }
    }
  }
  return result;
}
/** @param {ReadonlyMap<string,ReadonlySet<string>|null>} approvals
 * @param {string} path @param {string} [name] */
export function approvedG571Host(approvals, path, name) {
  const names = approvals.get(path);
  return names === null || names !== undefined && name !== undefined && names.has(name);
}
