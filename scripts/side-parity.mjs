#!/usr/bin/env node
// side-parity.mjs — SERVER-PARITY SS1 (meta docs/plans/SERVER-PARITY-PLAN.md): does the page stand on the same solids the
// server simulates? The rope bridge (NET-LAG NL5, engine f5424420) was exactly this gap: the page built Driftwood's plank
// chain from its client plan, the room's resident built none, and a room player walked on air and fell.
//
// Two halves, one inventory function:
//   - the page: the production bundle in headless Chromium, `?chunk=<slug>`, `app.physics` after boot (this file's CLI);
//   - the server: `openCellWorld`, the room's own composition (test/side-parity.test.ts, under Vitest for its TS imports).
// Each side lists every collider as (owner, material, rounded AABB); `sideParityDiff` groups them by owner and diffs.
// The page half is recorded into test/side-parity.page.json, reviewed like any fixture; CI diffs the live server against
// it on every run. Re-record when a shard pin or a page builder changes what the page builds:
//
//   node scripts/side-parity.mjs --record                       # serve dist/ (pnpm build:game first), all pinned shards
//   node scripts/side-parity.mjs --record --shard=driftwood-isle --url=http://127.0.0.1:4176
//
// Owners that are cosmetic or page-only by design are allowed only through test/side-parity.allow.json, each with a reason.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The pinned shards SS1 compares: the six that ship a native or runtime-plan world, plus the data-cell template. */
export const SIDE_PARITY_SHARDS = ['driftwood-isle', 'far-reach', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow', 'sunscar-dunes', '_template'];

/**
 * Every collider in a physics world as { owner, material, sensor, dynamic, box }. Self-contained: it is serialized into
 * the page (`page.evaluate`) as well as called on the server's host, so it reads only its `physics` argument.
 * `box` is the world AABB rounded to whole metres, [x0, y0, z0, x1, y1, z1].
 */
export function colliderInventory(physics) {
  const ownerKey = owner => {
    if (owner === null || owner === undefined) return null;
    if (typeof owner === 'string') return owner;
    if (typeof owner === 'object' && typeof owner.id === 'string') return owner.id;
    if (typeof owner === 'object' && typeof owner.kind === 'string') return `${owner.kind}`;
    // a shard's bake provenance (Pine: `{ pineWorldOwner }`, shard-pine-hollow generators/sourceOutput.ts) names the piece
    const keys = typeof owner === 'object' ? Object.keys(owner) : [];
    if (keys.length === 1 && (typeof owner[keys[0]] === 'string' || typeof owner[keys[0]] === 'number')) return `${owner[keys[0]]}`;
    return typeof owner === 'object' ? `(object:${Object.keys(owner).sort().slice(0, 4).join('|')})` : `(${typeof owner})`;
  };
  const rotate = (q, x, y, z) => {
    const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
    return [ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x];
  };
  const box = collider => {
    const t = collider.translation(), q = collider.rotation(), type = collider.shapeType(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const add = (x, y, z) => { const p = rotate(q, x, y, z); for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); } };
    const extents = (hx, hy, hz) => { for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) add(sx * hx, sy * hy, sz * hz); };
    if (type === 1 || type === 12) { const h = collider.halfExtents(), r = type === 12 ? collider.roundRadius() : 0; extents(h.x + r, h.y + r, h.z + r); }
    else if (type === 0) { const r = collider.radius(); extents(r, r, r); }
    else if (type === 2) { const r = collider.radius(); extents(r, collider.halfHeight() + r, r); }
    else if (type === 10 || type === 11 || type === 14 || type === 15) { const r = collider.radius(); extents(r, collider.halfHeight(), r); }
    else if (type === 7) {
      const s = collider.heightfieldScale(), heights = collider.heightfieldHeights(); let y0 = Infinity, y1 = -Infinity;
      for (const h of heights) { y0 = Math.min(y0, h * s.y); y1 = Math.max(y1, h * s.y); }
      add(-s.x / 2, y0, -s.z / 2); add(s.x / 2, y1, s.z / 2);
    } else if (type === 4 || type === 6 || type === 9 || type === 16) { const v = collider.vertices(); for (let i = 0; i + 2 < v.length; i += 3) add(v[i], v[i + 1], v[i + 2]); }
    if (lo[0] === Infinity) { lo.fill(0); hi.fill(0); } // a shape this does not measure: `shape` names it, and SS1 refuses it
    return [Math.round(t.x + lo[0]), Math.round(t.y + lo[1]), Math.round(t.z + lo[2]), Math.round(t.x + hi[0]), Math.round(t.y + hi[1]), Math.round(t.z + hi[2])];
  };
  const rows = [];
  physics.world.forEachCollider(collider => {
    const tag = physics.colliderTag(collider), body = collider.parent();
    if (!collider.isEnabled()) return;
    rows.push({ owner: ownerKey(tag?.owner), material: tag?.material ?? null, sensor: collider.isSensor(), dynamic: body?.isDynamic() === true, box: box(collider), shape: collider.shapeType() });
  });
  return rows;
}

/**
 * One name per owner on both sides: a streamed tile keeps its authored owner with an 8 × 8 tile suffix (`pier.c3`), the server's
 * bake prefixes its pieces (`piece:pier`, `string:platform.grid`), a streamed tree keeps its tile (`.trunks.t3`). An owner
 * object with no string id, or a creature's numeric id, is an actor (the player, a creature, a loose body): an entity the wire
 * carries, grouped as `actor`.
 */
export function ownerGroup(owner) {
  if (owner === null) return '(untagged)';
  if (owner.startsWith('(object') || owner === '(number)') return 'actor';
  return owner.replace(/^(?:piece|string):/u, '').replace(/\.c(?:[0-9]|[1-5][0-9]|6[0-3])$/u, '').replace(/\.trunks\.t\d+$/u, '');
}

/** A body of flesh is a creature, a person or a player on either side, whatever its owner: an actor. */
const groupOf = row => row.material === 'flesh' ? 'actor' : ownerGroup(row.owner);
/** The key two colliders must share to match: owner group, material, sensor or solid. */
/** The match key `row` would have under the owner group `group`. */
const keyAs = (row, group, material = row.material) => `${row.sensor ? 'sensor:' : ''}${group}|${material ?? '-'}`;
const matchKey = row => keyAs(row, groupOf(row));
/** The allow key: owner group, sensors apart. */
const allowKey = row => `${row.sensor ? 'sensor:' : ''}${groupOf(row)}`;
const near = (a, b, slack) => a.every((value, i) => Math.abs(value - b[i]) <= slack);

/** Rows grouped by owner (allow key): how many, which materials, the union box. */
export function groupInventory(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = allowKey(row);
    let group = groups.get(key);
    if (group === undefined) groups.set(key, group = { count: 0, materials: new Set(), box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] });
    group.count++;
    if (row.material !== null) group.materials.add(row.material);
    for (let i = 0; i < 3; i++) { group.box[i] = Math.min(group.box[i], row.box[i]); group.box[i + 3] = Math.max(group.box[i + 3], row.box[i + 3]); }
  }
  return groups;
}

/** The page streams its solids around the player (NearColliders: load at 70 m, drop at 85 m); inside this disc both sides hold every solid. */
export const PAGE_DISC = 50;

/** The Rapier shape types `colliderInventory` measures a box for; any other one (a compound, a half space) is refused, not guessed. */
export const MEASURED_SHAPES = Object.freeze([0, 1, 2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16]);

/**
 * The page-vs-server diff for one shard, one line per owner and material that disagrees; an empty list means the halves agree.
 * Each page collider needs a server collider of the same owner, material and kind whose rounded box is within `slack` metres
 * on every face (a dynamic one, a rope plank that sways, within 2 × `slack`). Each server collider that lies inside the page's
 * near ball around `at` needs a page match the same way; past it, the page may simply not have streamed it yet.
 * A collider whose only match is the same shape under another owner or material is a solid both sides stand on, but its
 * owner or material drifted (a hit, a sound, an interaction reads those); that is one line per owner pair, and a lesser finding.
 * `allow` maps an allow key (owner, `sensor:` prefixed for a sensor) to why it may differ; it is skipped both ways.
 * `same` (SS10) maps a server owner group to the page owner group that may name the same pieces (a gate named for its door,
 * a bake's 150-collider chunk): a collider with no match under its own name may match one under that name, still one to
 * one and by material and shape. `sameMaterial` (HS7's owed SS1 line) maps such a server owner group to `{ server, page }`, the
 * material each side names it by (Driftwood's boat: `wood` on the server, `planks` on the page); any other material still differs.
 * `chunked` lists page owner groups a chunked page registers once per chunk a piece spans (Driftwood's pier deck): exact
 * copies of one of their pieces (owner group, material, kind, box) are that one solid.
 * A static page solid with no server match that lies inside a server edge wall (`edge`) is no finding: the wall stands there.
 */
/** A `chunked` page piece's identity: one solid whatever chunk registered it (boxes are whole metres, so two thin pieces in one
 *  metre cell of different chunks would read as one; none do today). */
export const chunkCopyKey = row => `${matchKey(row)}|${row.dynamic}|${row.shape}|${row.box.join(',')}`;
/** The material `row` goes by under the other side's name for it: `named` is a `sameMaterial` entry, `{ server, page }`. */
function materialAs(row, side, named) {
  if (named === undefined) return row.material;
  const [mine, theirs] = side === 'page' ? [named.page, named.server] : [named.server, named.page];
  return row.material === mine ? theirs : row.material;
}

export function sideParityDiff(paged, server, at, allow = {}, { slack = 1, same = {}, sameMaterial = {}, chunked = [] } = {}) {
  // without the page's player, the server-to-page half would check nothing and pass
  if (at === null || at.length !== 3) throw new Error('Side parity needs the page player position its half was recorded at');
  // a copy is the same piece under another chunk's owner; two in one chunk are still two
  const copies = new Map(), page = paged.filter(row => {
    if (!chunked.includes(groupOf(row))) return true;
    const key = chunkCopyKey(row), owners = copies.get(key);
    if (owners === undefined) { copies.set(key, new Set([row.owner])); return true; }
    if (owners.has(row.owner)) return true;
    owners.add(row.owner); return false;
  });
  const index = rows => { const map = new Map(); for (const row of rows) { const key = matchKey(row); let list = map.get(key); if (list === undefined) map.set(key, list = []); list.push(row); } return map; };
  const pages = index(page), servers = index(server), findings = new Map();
  // the example is the smallest box, so a line does not change with the order a world lists its colliders
  const order = (a, b) => a.findIndex((value, i) => value !== b[i]);
  const smaller = (a, b) => { const i = order(a, b); return i !== -1 && a[i] < b[i]; };
  const note = (key, example, line) => { const seen = findings.get(key); if (seen === undefined) findings.set(key, { line, example, count: 1 }); else { seen.count++; if (smaller(example, seen.example)) seen.example = example; } };
  const close = (row, other) => row.sensor === other.sensor && near(row.box, other.box, row.dynamic || other.dynamic ? 2 * slack : slack);
  const spread = (row, other) => Math.max(...row.box.map((value, i) => Math.abs(value - other.box[i])));
  const describe = row => `${allowKey(row)} (${row.material ?? '-'}${row.dynamic ? ', dynamic' : ''})`;
  const check = (row, others, used, all, side) => {
    // one to one: each collider on the other side stands in for one collider here, so half a plank chain is a finding
    let best = null;
    // its own name first; then the other side's name for it that `same` declares (a page owner may have several server names)
    const names = side === 'page' ? Object.keys(same).filter(name => same[name] === groupOf(row)) : Object.hasOwn(same, groupOf(row)) ? [same[groupOf(row)]] : [];
    for (const key of [matchKey(row), ...names.map(name => keyAs(row, name, materialAs(row, side, side === 'page' ? sameMaterial[name] : sameMaterial[groupOf(row)])))]) {
      for (const other of others.get(key) ?? []) if (!used.has(other) && close(row, other) && (best === null || spread(row, other) < spread(row, best))) best = other;
      if (best !== null) break;
    }
    if (best !== null) { used.add(best); return; }
    const shape = all.find(other => close(row, other));
    const inside = (outer, inner) => [0, 1, 2].every(i => inner[i] >= outer[i] - slack && inner[i + 3] <= outer[i + 3] + slack);
    if (shape === undefined && side === 'page' && !row.sensor && !row.dynamic && all.some(other => other.material === 'edge' && !other.sensor && inside(other.box, row.box))) return;
    if (shape === undefined) { note(`${side}|${matchKey(row)}|${row.dynamic}`, row.box, (count, box) => side === 'page'
      ? `${describe(row)}: ${count} page collider(s) with no server match, e.g. [${box.join(', ')}]`
      : `${describe(row)}: ${count} server collider(s) near the page's player with no page match, e.g. [${box.join(', ')}]`); return; }
    const [p, s] = side === 'page' ? [row, shape] : [shape, row], other = side === 'page' ? 'server' : 'page';
    // a server that tags nothing (Nalati's bake) is one line, not one per page owner
    if (s.owner === null && s.material === null && p.owner !== null) note(`${side}|shape|untagged`, row.box, count => `(untagged server): ${count} ${side}-side match(es) where the server collider has no owner or material`);
    else if (matchKey(row) === matchKey(shape)) note(`${side}|extra|${matchKey(row)}`, row.box, count => `${describe(row)}: ${count} ${side} collider(s) more than the ${other} holds in the same place`);
    else note(`${side}|shape|${matchKey(row)}|${matchKey(shape)}`, row.box, count => `${describe(row)}: ${count} ${side} collider(s) the ${other} holds as ${describe(shape)}, same shape`);
  };
  const toServer = new Set(), toPage = new Set();
  for (const row of page) if (!Object.hasOwn(allow, allowKey(row))) check(row, servers, toServer, server, 'page');
  const gap = (row, axis) => Math.max(row.box[axis] - at[axis], 0, at[axis] - row.box[axis + 3]);
  const inBall = row => Math.hypot(gap(row, 0), gap(row, 1), gap(row, 2)) <= PAGE_DISC;
  for (const row of server) if (!Object.hasOwn(allow, allowKey(row)) && inBall(row)) check(row, pages, toPage, page, 'server');
  return [...findings.values()].map(({ line, count, example }) => line(count, example)).sort((x, y) => x.localeCompare(y));
}

// ── CLI: record the page half ──
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PAGE_FILE = resolve(ROOT, 'test/side-parity.page.json');

async function recordPage(argv) {
  const flag = (name, fallback) => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const { chromium, devices } = await import('playwright');
  const { KEYCHAIN_ARGS } = await import('./chromium-keychain.mjs');
  const { waitForPhysicsBoot } = await import('./physics-grid-entry.mjs');
  const only = flag('shard', ''), shards = only === '' ? SIDE_PARITY_SHARDS : only.split(','), port = Number(flag('port', '4177')), timeout = Number(flag('timeout', '240')) * 1000;
  let base = flag('url', ''), preview = null;
  if (base === '') {
    if (!existsSync(resolve(ROOT, 'dist/index.html'))) throw new Error('dist/ missing: run pnpm build:game first, or pass --url');
    preview = spawn(process.execPath, [resolve(ROOT, 'scripts/preview-server.mjs'), '--root', ROOT, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((_resolve, _reject) => {
      const late = setTimeout(() => { preview.kill('SIGTERM'); _reject(new Error('preview did not come up in 30 s')); }, 30_000);
      preview.stdout.on('data', data => { if (String(data).includes(`:${port}/`)) { clearTimeout(late); _resolve(); } });
      preview.on('exit', code => { clearTimeout(late); _reject(new Error(`preview exited ${code}`)); });
    });
    base = `http://127.0.0.1:${port}`;
  }
  const recorded = existsSync(PAGE_FILE) ? JSON.parse(readFileSync(PAGE_FILE, 'utf8')) : { shards: {}, at: {} };
  recorded.at ??= {};
  // a shard SS1 no longer compares leaves the fixture
  for (const slug of Object.keys(recorded.shards)) if (!SIDE_PARITY_SHARDS.includes(slug)) { delete recorded.shards[slug]; delete recorded.at[slug]; }
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
    for (const slug of shards) {
      const context = await browser.newContext({ ...devices['iPhone 16 Pro'] }), page = await context.newPage();
      try {
        await page.goto(`${base}/?chunk=${slug}&tier=phone&skipintro=1&nolock=1&sw=0&mute=1`, { waitUntil: 'commit', timeout });
        await waitForPhysicsBoot(page, 'standalone', timeout);
        await page.waitForTimeout(Number(flag('settle', '3000')));
        const rows = await page.evaluate(`(${colliderInventory.toString()})(window.__wildshard.world.game.app.physics)`);
        const at = await page.evaluate(() => { const p = window.__wildshard.world.player.position; return [Math.round(p.x), Math.round(p.y), Math.round(p.z)]; });
        recorded.shards[slug] = rows; recorded.at[slug] = at;
        console.error(`side-parity page ${slug}: ${rows.length} colliders, ${groupInventory(rows).size} owners`);
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); preview?.kill('SIGTERM'); }
  recorded.note = 'SS1 page half: node scripts/side-parity.mjs --record (see its header). Rows: owner, material, sensor, dynamic, box.';
  // one collider per line, so a re-record reviews as a short diff
  const slugs = Object.keys(recorded.shards).sort();
  const body = slugs.map(slug => `  ${JSON.stringify(slug)}: [\n${recorded.shards[slug].map(row => `   ${JSON.stringify(row)}`).join(',\n')}\n  ]`).join(',\n');
  const at = slugs.map(slug => `  ${JSON.stringify(slug)}: ${JSON.stringify(recorded.at[slug] ?? null)}`).join(',\n');
  writeFileSync(PAGE_FILE, `{\n "note": ${JSON.stringify(recorded.note)},\n "at": {\n${at}\n },\n "shards": {\n${body}\n }\n}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const argv = process.argv.slice(2);
  if (argv.includes('--record')) await recordPage(argv);
  else { console.error('usage: node scripts/side-parity.mjs --record [--shard=a,b] [--url=<served build>]'); process.exit(2); }
}
