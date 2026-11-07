import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { homedir } from 'node:os';
import { exportedPath } from '../../lint/layer-exports.mjs';

/** @param {string} root @param {string} path @param {string} spec */
function imported(root, path, spec) {
  const alias = /^@wildshard\/(engine|game|kit)(?:\/(.*))?$/.exec(spec); // E432: the layers' workspace packages
  const base = spec.startsWith('../parity') ? posix.join(posix.dirname(path), spec) : alias ? (alias[2] === undefined ? null : exportedPath(alias[1], alias[2], root)) ?? `src/${alias[1]}/${alias[2] ?? 'index'}` : '';
  return base ? [base, `${base}.ts`, `${base}/index.ts`].find((p) => existsSync(join(root, p))) : undefined;
}
/** Import reachability gives shared-system changes a reproducible score; direct shard changes take priority.
 * @param {string} root @param {string[]} shards @param {string[]} changed @param {number} rotation */
export function fastSelection(root, shards, changed, rotation) {
  if (shards.length < 2) throw new Error('usage: --fast needs at least two candidate shards');
  const graph = new Map();
  /** @param {string} directory */
  function visit(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(join(root, path), 'utf8');
        const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)]
          .map((m) => imported(root, path, m[1])).filter((p) => typeof p === 'string');
        graph.set(path, imports);
      }
    }
  }
  visit('src');
  const shared = changed.filter((p) => /^src\/(engine|game|kit)\//.test(p));
  const rows = shards.map((shard, index) => {
    const direct = changed.filter((p) => p.startsWith(`src/shards/${shard}/`));
    const seen = new Set(), queue = [`src/shards/${shard}/manifest.ts`];
    while (queue.length > 0) { const path = queue.pop(); if (!path || seen.has(path)) continue; seen.add(path); queue.push(...graph.get(path) ?? []); }
    const systems = shared.filter((p) => seen.has(p));
    return { shard, score: direct.length * 1000000 + systems.length, direct, systems,
      order: (index - rotation % shards.length + shards.length) % shards.length };
  });
  rows.sort((a, b) => b.score - a.score || a.order - b.order);
  return rows.slice(0, 2).map((row) => ({ shard: row.shard,
    reason: row.direct.length > 0 ? `${row.direct.length} changed shard files` : row.systems.length > 0
      ? `${row.systems.length} reachable changed shared systems; rotating tie-break ${rotation}` : `rotating coverage pair ${rotation}` }));
}
/** Persistent tie-break advances by two so consecutive unweighted batches cover all four shards.
 * @param {string} [path] */
export function nextRotation(path = join(homedir(), '.cache/wildshard-parity/fast-rotation.json')) {
  const value = existsSync(path) ? Number(JSON.parse(readFileSync(path, 'utf8')).next) : 0;
  const rotation = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify({ next: rotation + 2 }));
  return rotation;
}
