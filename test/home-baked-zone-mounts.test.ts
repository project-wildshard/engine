// Standalone shardfiles SF11: no pin copies a zone's mounts under public/, so a home-baked page (local build:game, the
// dev server, local staging QA's rig) lists a zone's mounts in its own manifests, as the zone's cook does (cookShard: its
// folder rows and its mount rows per set), and writes what no part may hold at its URL. Before, the build listed only
// folder rows and own audio, so a model past the fence (Driftwood's fp-arms.glb, K3) and a loose image (Dunes' sky,
// tests (9)) answered 404.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the cook's own output folder.
import { existsSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the cook's output paths.
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readBuiltSpawnManifest } from '../src/cook/game/engineHalf';
import { cookFilesOnly } from './filesOnlyCook';

test("a home-baked page's manifests carry the zone's mounts past its fence, and its loose mounts sit at their URLs", async () => {
  const { root, output, book } = await cookFilesOnly(['made-up-fence'], 'home-baked-mounts', { from: 'test/fixtures' });
  try {
    const listed = (address: { url: string } | undefined): string[] => {
      if (address === undefined) throw new Error('no manifest');
      return readBuiltSpawnManifest(output, address as never).files.map(row => row.url.split('?')[0] ?? row.url);
    };
    const phoneWhole = listed(book.packs.client['made-up-fence']?.phone), desktopWhole = listed(book.packs.client['made-up-fence']?.desktop);
    const phoneEntry = listed(book.client['made-up-fence']?.phone);
    // the fence's own file is in the entry; the phone-only file past the fence is only in the phone's whole level
    expect(phoneEntry).toContain('/assets/cli-fixture/props/fenced.bin');
    expect(phoneWhole).toContain('/assets/cli-fixture/baked/rain.phone.bin');
    expect(desktopWhole).not.toContain('/assets/cli-fixture/baked/rain.phone.bin');
    // the zone's own sfx recording rides its whole level on both tiers
    for (const whole of [phoneWhole, desktopWhole]) expect(whole).toContain('/assets/cli-fixture/sfx/cli-fixture/gull-1-1a358b4e.m4a');
    // a mount no part may hold (outside /assets/) is written at its URL, with its bytes
    const loose = join(output, 'programs/cli-fixture.json');
    expect(existsSync(loose)).toBe(true);
    expect(readFileSync(loose).equals(readFileSync('test/fixtures/made-up-fence/mounts/programs/cli-fixture.json'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);
