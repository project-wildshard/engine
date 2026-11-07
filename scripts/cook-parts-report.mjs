#!/usr/bin/env node
// C1: what each shard's packs book costs on the wire, read from a finished build: its parts, what those parts carry that its
// own manifest doesn't list (over-fetch), and how many it shares with other shards.
//   node scripts/cook-parts-report.mjs [--dist=dist] [--tier=phone] [--check]
// --check fails a part that lists a member outside its manifest, or sizes that don't add up.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** @param {string} name @param {string} fallback @returns {string} */
const flag = (name, fallback) => process.argv.find(row => row.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const dist = resolve(flag('dist', 'dist')), tier = flag('tier', 'phone'), check = process.argv.includes('--check');
const { build } = JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8'));
const book = JSON.parse(readFileSync(join(dist, `assets/spawn/packs-${build}.json`), 'utf8'));
const manifests = Object.entries(book.client).map(([slug, row]) => [slug, JSON.parse(readFileSync(join(dist, row[tier].url.slice(1)), 'utf8'))]);
const users = new Map();
for (const [slug, manifest] of manifests) for (const part of manifest.parts ?? []) (users.get(part.url) ?? users.set(part.url, new Set()).get(part.url)).add(slug);
const problems = [], rows = [];
for (const [slug, manifest] of manifests) {
  const parts = manifest.parts ?? [];
  let raw = 0, wire = 0, used = 0;
  for (const part of parts) {
    raw += part.bytes; wire += part.wireBytes ?? 0;
    for (const [member] of part.members) {
      const file = manifest.files[member];
      if (file === undefined) problems.push(`${slug}: ${part.url} lists member ${member} past its ${manifest.files.length} files`);
      else used += file.bytes;
    }
  }
  if (used > raw) problems.push(`${slug}: members hold ${used} bytes in ${raw} bytes of parts`);
  rows.push({ slug, parts: parts.length, rawMB: Number((raw / 1e6).toFixed(1)), wireMB: Number((wire / 1e6).toFixed(1)), overFetchMB: Number(((raw - used) / 1e6).toFixed(1)), shared: parts.filter((/** @type {{ url: string }} */ part) => (users.get(part.url)?.size ?? 0) > 1).length });
}
console.table(rows.filter(row => row.parts > 0).sort((a, b) => b.wireMB - a.wireMB).slice(0, 12));
for (const line of problems) console.error(line);
if (check && problems.length > 0) process.exitCode = 1;
