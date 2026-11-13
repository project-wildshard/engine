// oxlint-disable-next-line import/no-nodejs-modules -- The room half boots the shipped product bytes and physics module.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CLIENT_FEATURE_SIDES, WORLD_ASSEMBLY_STAGE_SIDES } from '@wildshard/format/featureSides';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { missingInstallers, SERVER_INSTALLERS, serverSides } from '../src/server/host/installers';
import { installedKeys } from '../src/server/game/shardfile/installedSides';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { SaveStore } from '../src/shared/engine/saves/store';
import { builtProduct, runtimeAssets } from './fixtures/engine-lift/product';

// SERVER-PARITY SS3 (meta docs/plans/SERVER-PARITY-PLAN.md). SS2 gives every `client/plan` kind a side and, for a `both` or
// `server` kind, the key its server installer registers under (src/server/host/installers.ts). This boots every pinned product
// that declares one the way a room does (`openCellWorld`, whole solids, no page) and fails on a sided kind whose key no
// installer registered: NET-LAG NL5's rope bridge, a page-built `rope-deck` the room never built, is that shape.
// A shard with an open gap lists each exact line under KNOWN with the row that owns it, so CI stays green while the row is open
// and goes red when the gap changes or closes unrecorded.

// SS4 to SS6 (stealth, the Pine secret, the fall floor) landed before SS3, so none of their lines is open here; SS3b closed
// Driftwood's keepsakes (loot/keepsakeProgression.ts), Nalati's adventure saves (serverChapters.ts, chapterRecords.ts) and
// Nine Dragon's places (shard-format v0.4.9 sides `world.sets` and `world.bind-sets` as `view`: they only list placed models).
const KNOWN: Readonly<Record<string, { readonly row: string; readonly lines: readonly string[] }>> = {
  'driftwood-isle': { row: 'HS6: `bridge-sway` is a page-only pose view, and SS2 sides every view.program `both` for the slots and open arena',
    lines: ['client/plan view.program (poseViews)'] },
  'nine-dragon-stack': { row: 'HS6: `movers` is a page-only pose view', lines: ['client/plan view.program (poseViews)'] },
};

/** The pins whose products declare a `both` or `server` kind today: one that loses them in a re-cook fails, not skips. */
const SIDED = ['driftwood-isle', 'far-reach', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow', 'sunscar-dunes'];
const pins = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: readonly { slug: string }[] }).shards.map(pin => pin.slug);

test('every SS2 server key has an installer entry, and every entry is an SS2 key', () => {
  const keys = new Set([...Object.values(CLIENT_FEATURE_SIDES), ...Object.values(WORLD_ASSEMBLY_STAGE_SIDES)].flatMap(entry => entry.side === 'view' ? [] : [entry.server]));
  expect([...keys].sort()).toEqual(Object.keys(SERVER_INSTALLERS).sort());
});

describe('side installers: a room installs every server half its product declares', { concurrent: false }, () => {
  for (const slug of pins) test(slug, async () => {
    // the pinned `template` installs as out/_template
    const directory = builtProduct(slug === 'template' ? '_template' : slug);
    if (!existsSync(directory)) throw new Error(`${slug} is pinned but not installed: pnpm pins`);
    const product = await loadHeadlessProduct(directory);
    expect(serverSides(product).length > 0, `${slug}: declares a server half`).toBe(SIDED.includes(slug));
    if (!SIDED.includes(slug)) { expect(KNOWN[slug]).toBeUndefined(); return; }
    const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
    const world = await openCellWorld({ instance: slug }, { shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier }, undefined,
      { saves: new SaveStore({ local: null, session: null }), lone: true, wholeSolids: true, pageless: true });
    try {
      const ran = installedKeys(world.host);
      expect(missingInstallers(product, ran), `${slug}: sided kinds with no server installer`).toEqual(KNOWN[slug]?.lines ?? []);
      if (slug === 'driftwood-isle') {
        // the table's half of the pre-NL5 room: without the rope decks' key, both rope stages are named (dropping the
        // `installRopeDecks` call itself fails the line above the same way, checked by hand when SS3 landed)
        const pre = missingInstallers(product, new Set([...ran].filter(key => key !== 'ropeDecks')));
        expect(pre.filter(line => !(KNOWN[slug]?.lines ?? []).includes(line))).toEqual(['world.assembly rope-deck (ropeDecks)', 'world.assembly rope-chain (ropeDecks)']);
      }
    } finally { world.dispose(); }
  }, 120_000);
});
