// oxlint-disable-next-line import/no-nodejs-modules -- The server half boots the shipped product bytes and physics module.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { SaveStore } from '../src/shared/engine/saves/store';
import { colliderInventory, MEASURED_SHAPES, ownerGroup, sideParityDiff, SIDE_PARITY_SHARDS } from '../scripts/side-parity.mjs';
import { builtProduct, runtimeAssets } from './fixtures/engine-lift/product';

// SERVER-PARITY SS1 (meta docs/plans/SERVER-PARITY-PLAN.md). The page stands the player on colliders it builds live from the
// product; the room simulates the colliders `openCellWorld` builds. NET-LAG NL5 (f5424420) was a gap between the two: the page
// stood on Driftwood's rope-bridge planks, the room had none, and a room player fell through. This boots each pinned shard the
// way a room does and diffs its colliders, grouped by owner, against the page's (test/side-parity.page.json, recorded from the
// production bundle by `node scripts/side-parity.mjs --record`). A page-only or cosmetic owner needs a reason in
// test/side-parity.allow.json; a shard with a known open gap lists it under `known` with its plan row, so CI stays green while
// the row is open and goes red if the gap changes or closes unrecorded.

interface Same { readonly page: string; readonly why: string }
interface Allow { readonly owners: Readonly<Record<string, string>>; readonly shards: Readonly<Record<string, { readonly row?: string; readonly owners?: Readonly<Record<string, string>>; readonly same?: Readonly<Record<string, Same>>; readonly known?: readonly string[] }>> }
const page = JSON.parse(readFileSync('test/side-parity.page.json', 'utf8')) as { at: Record<string, readonly number[] | null>; shards: Record<string, Parameters<typeof sideParityDiff>[0]> };
const allow = JSON.parse(readFileSync('test/side-parity.allow.json', 'utf8')) as Allow;

test('a room without the rope chain is a finding that names the bridge (the pre-NL5 shape)', () => {
  const rows = page.shards['driftwood-isle'] ?? [], at = page.at['driftwood-isle'] ?? null;
  expect(sideParityDiff(rows, rows, at, allow.owners)).toEqual([]);
  const findings = sideParityDiff(rows, rows.filter(row => !(row.owner === 'bridge' && row.dynamic)), at, allow.owners);
  expect(findings.some(line => line.startsWith('bridge (wood, dynamic): ') && line.includes('no server match'))).toBe(true);
  // matching is one to one: a chain one plank short is a finding too
  const planks = rows.filter(row => row.owner === 'bridge' && row.dynamic), short = planks[Math.floor(planks.length / 2)];
  expect(sideParityDiff(rows, rows.filter(row => row !== short), at, allow.owners)).not.toEqual([]);
  expect(() => sideParityDiff(rows, rows, null, allow.owners)).toThrow('page player position');
});

test('a server name the shard declares the same as the page\'s still needs its solids; a page solid inside an edge wall is the wall (SS10)', () => {
  const box = (owner: string | null, material: string, b: readonly number[]) => ({ owner, material, sensor: false, dynamic: false, box: [...b], shape: 1 });
  const at = [0, 0, 0], door = box('mill-door-bar', 'wood', [1, 0, 1, 2, 2, 2]), wall = box(null, 'edge', [249, -60, -252, 251, 400, 252]);
  expect(sideParityDiff([door], [box('cabin-7-door-bar', 'wood', [1, 0, 1, 2, 2, 2])], at)).toHaveLength(2);
  expect(sideParityDiff([door], [box('cabin-7-door-bar', 'wood', [1, 0, 1, 2, 2, 2])], at, {}, { same: { 'cabin-7-door-bar': 'mill-door-bar' } })).toEqual([]);
  // the name is the same; the material and the shape still have to agree
  expect(sideParityDiff([door], [box('cabin-7-door-bar', 'stone', [1, 0, 1, 2, 2, 2])], at, {}, { same: { 'cabin-7-door-bar': 'mill-door-bar' } })).not.toEqual([]);
  expect(sideParityDiff([door], [box('cabin-7-door-bar', 'wood', [5, 0, 1, 6, 2, 2])], at, {}, { same: { 'cabin-7-door-bar': 'mill-door-bar' } })).not.toEqual([]);
  // a deck's sill inside the server's edge wall, and one that pokes out of it
  expect(sideParityDiff([wall, box('deck', 'stone', [249, 0, -4, 250, 3, 4])], [wall], at)).toEqual([]);
  expect(sideParityDiff([wall, box('deck', 'stone', [245, 0, -4, 250, 3, 4])], [wall], at)).not.toEqual([]);
});

describe('side parity: the page and the room build the same gameplay colliders', { concurrent: false }, () => {
  for (const slug of SIDE_PARITY_SHARDS) test(slug, async () => {
    const rows = page.shards[slug];
    if (rows === undefined) throw new Error(`${slug} has no recorded page half: node scripts/side-parity.mjs --record --shard=${slug}`);
    const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), shard = product.shardfile;
    const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
    const world = await openCellWorld({ instance: slug }, { shard, product, assets: runtimeAssets(product, directory), rapier }, undefined,
      { saves: new SaveStore({ local: null, session: null }), lone: true, wholeSolids: true, pageless: true });
    try {
      const server = colliderInventory(world.host.physics), own = allow.shards[slug];
      // a shape with no measured box (a compound, a half space) would match anything at its origin: refuse it on both sides
      expect([...new Set([...rows, ...server].map(row => row.shape))].filter(shape => !MEASURED_SHAPES.includes(shape))).toEqual([]);
      const same = Object.fromEntries(Object.entries(own?.same ?? {}).map(([server, row]) => [server, row.page]));
      // a declared name stands only while both sides still use it: a renamed piece drops its line from the allow file
      expect(Object.entries(same).filter(([name, as]) => !server.some(row => ownerGroup(row.owner) === name) || !rows.some(row => ownerGroup(row.owner) === as)), `${slug}: stale same names`).toEqual([]);
      const findings = sideParityDiff(rows, server, page.at[slug] ?? null, { ...allow.owners, ...own?.owners }, { same });
      // WS_SIDE_PARITY_REPORT=<folder>: keep each shard's findings and server rows there, to read beside the page half
      const report = process.env['WS_SIDE_PARITY_REPORT'];
      if (report !== undefined) { mkdirSync(report, { recursive: true }); writeFileSync(`${report}/${slug}.json`, JSON.stringify({ findings, server }, null, 1)); }
      expect(findings, `${slug}: page vs server colliders`).toEqual(own?.known ?? []);
    } finally { world.dispose(); }
  }, 120_000);
});
