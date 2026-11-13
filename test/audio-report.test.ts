// AUDIO AU6 (J303, J295): the cook reports each shard's audio and its share of DOWNLOAD, per tier, against Jake's lines
// (green to 6 MB, amber over 6, red over 10). An overrun is an AMBER line that CI's budget reporter annotates and
// main-watch receipts (test/main-watch.test.ts), never a red build or main.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the pinned products and remove the cook's folder.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { AUDIO_LINES, audioAmberLine, audioLevel, audioReport, audioReportTable, type AudioReportManifest } from '../src/cook/game/audioReport';
import { readBuiltSpawnManifest } from '../src/cook/game/engineHalf';
import { parseAudioAmber } from '../scripts/test-amber.mjs';
import { cookFilesOnly, type FilesOnlyCook } from './filesOnlyCook';

// A synthetic shard's client manifest: `audio` MB of recordings (own and shared) beside 12 MB of everything else.
const manifest = (shard: string, tier: 'phone' | 'desktop', audio: number): AudioReportManifest => {
  const files = [{ url: '/assets/world-abc12345.bin', bytes: 12e6, wireBytes: 12e6 },
    { url: `/assets/music/piano/title-1a2b3c4d.m4a`, bytes: audio * 0.25, wireBytes: audio * 0.25 },
    { url: `/assets/sfx/best/hit.m4a?v=1a2b3c4d`, bytes: audio * 0.25 },
    { url: `/assets/music/${shard}/theme-1a2b3c4d.m4a`, bytes: audio * 0.5, wireBytes: audio * 0.5 }];
  return { shard, tier, files, wireBytes: files.reduce((sum, row) => sum + (row.wireBytes ?? row.bytes), 0) };
};

test('a synthetic shard over each line: green to 6 MB, amber over it, red over 10 MB, and only an overrun is AMBER', () => {
  expect([0, 6_000_000, 6_000_001, 10_000_000, 10_000_001].map(bytes => audioLevel(bytes))).toEqual(['green', 'green', 'amber', 'amber', 'red']);
  const rows = audioReport([manifest('under', 'desktop', 5.9e6), manifest('under', 'phone', 5.9e6), manifest('over-six', 'phone', 7.2e6), manifest('over-ten', 'phone', 10.4e6)]);
  expect(rows.map(row => [row.shard, row.tier, row.files, row.audioBytes, row.level])).toEqual([
    ['over-six', 'phone', 3, 7.2e6, 'amber'], ['over-ten', 'phone', 3, 10.4e6, 'red'], ['under', 'phone', 3, 5.9e6, 'green'], ['under', 'desktop', 3, 5.9e6, 'green']]);
  // DOWNLOAD is the manifest's whole wire total, the shared and own audio included.
  expect(rows[0]?.downloadBytes).toBe(19.2e6);
  const table = audioReportTable(rows).split('\n');
  expect(table[0]).toContain('green to 6.00 MB');
  expect(table.find(line => line.startsWith('over-six'))).toMatch(/over-six\s+phone\s+3\s+7\.20\s+19\.20\s+38%\s+AMBER$/u);
  expect(table.find(line => line.startsWith('over-ten'))).toMatch(/10\.40\s+22\.40\s+46%\s+RED$/u);
  expect(table.filter(line => line.startsWith('under')).every(line => line.endsWith('green'))).toBe(true);
  // The AMBER lines main-watch reads: one per overrun, the red one still AMBER (J295), and nothing for a green row.
  const lines = rows.filter(row => row.level !== 'green').map(audioAmberLine);
  expect(parseAudioAmber(lines.join('\n'))).toEqual([
    { shard: 'over-six', tier: 'phone', bytes: 7.2e6, budget: AUDIO_LINES.greenBytes, red: AUDIO_LINES.redBytes, level: 'amber' },
    { shard: 'over-ten', tier: 'phone', bytes: 10.4e6, budget: AUDIO_LINES.greenBytes, red: AUDIO_LINES.redBytes, level: 'red' }]);
  expect(lines.every(line => line.startsWith('AMBER audio '))).toBe(true);
});

// Every pinned product (`pnpm pins`, as CI's test jobs install them), through the real cook, files only.
const PINNED = existsSync('out') ? readdirSync('out').filter(name => !name.startsWith('.') && existsSync(`out/${name}/shard.json`)).sort() : [];
const have = ['driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack'].every(shard => PINNED.includes(shard));
let cook: FilesOnlyCook | undefined, printed: string[] = [];
beforeAll(async () => {
  if (!have) return;
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  try { cook = await cookFilesOnly(PINNED, 'audio-report'); printed = info.mock.calls.map(call => String(call[0])); }
  finally { info.mockRestore(); }
}, 120_000);
afterAll(() => { if (cook !== undefined) rmSync(cook.root, { recursive: true, force: true }); });

test.skipIf(!have)('the cook prints the table for every pinned shard and tier, and CI annotates each shard over 6 MB', async ({ annotate }) => {
  if (cook === undefined) throw new Error('no cook');
  const { book, output } = cook;
  const rows = audioReport(Object.values(book.client).flatMap(pair => [readBuiltSpawnManifest(output, pair.phone), readBuiltSpawnManifest(output, pair.desktop)]));
  const table = audioReportTable(rows);
  // The cook's own print is this table: the same manifests, the same rows.
  expect(printed).toContain(table);
  expect(rows.map(row => `${row.shard} ${row.tier}`)).toEqual(Object.keys(book.client).sort().flatMap(shard => [`${shard} phone`, `${shard} desktop`]));
  for (const shard of ['driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack']) {
    const phone = rows.find(row => row.shard === shard && row.tier === 'phone');
    expect(phone?.files, shard).toBeGreaterThan(0);
    // The same recordings on every tier (AU1).
    expect(rows.find(row => row.shard === shard && row.tier === 'desktop')?.audioBytes, shard).toBe(phone?.audioBytes);
  }
  process.stdout.write(`${table}\n`);
  // AMBER, never red (J295): the budget reporter turns each into a ::warning that main-watch receipts.
  for (const row of rows.filter(line => line.level !== 'green')) await annotate(audioAmberLine(row), 'warning');
});
