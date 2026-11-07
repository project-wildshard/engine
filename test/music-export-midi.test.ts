// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real offline CLI without a dev server or browser.
import { execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Preserve complete pre-conversion MIDI bytes through their independent hashes.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove only the export fixture's files.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine MIDI output to repository tmp.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

// Captured from the original CLI using its real TypeScript score, served only
// for the predecessor's Vite-text intake. Every byte and all eight tracks stay.
const originals = [
  { name: 'theme', bytes: 6517, hash: '8a4cff2c8c9279ec8a3b1ffc55d8a2a7772017f64b733f6e00f7e3f2766a11de', notes: 736 },
  { name: 'trailer30', bytes: 3264, hash: '89bbf173d2e06d4b3c523ed0258ba803c9e3ab1a01e40a62d0e9186b6ae27165', notes: 345 },
  { name: 'trailer15', bytes: 1756, hash: '924dc06de7dfade912eb79a6dbcb405a934b1f1a5623a1a264d808f09d852dc9', notes: 174 },
];

for (const original of originals) {
  test(`${original.name} exports the complete original MIDI without transformed module transport`, () => {
    mkdirSync('tmp', { recursive: true });
    const directory = mkdtempSync(resolve('tmp', 'midi-export-'));
    try {
      const file = resolve(directory, 'score.mid');
      const output = execFileSync(process.execPath, ['scripts/music/export-midi.mjs', original.name, file], { encoding: 'utf8', timeout: 15_000 });
      const bytes = readFileSync(file);
      expect(bytes.length).toBe(original.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(original.hash);
      expect(bytes.toString('ascii', 0, 4)).toBe('MThd');
      expect(bytes.readUInt16BE(8)).toBe(1);
      expect(bytes.readUInt16BE(10)).toBe(8);
      expect(output).toContain(`${original.notes} notes`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('an unknown arrangement refuses without publishing an output', () => {
  mkdirSync('tmp', { recursive: true });
  const directory = mkdtempSync(resolve('tmp', 'midi-refusal-'));
  try {
    const file = resolve(directory, 'absent.mid');
    const result = spawnSync(process.execPath, ['scripts/music/export-midi.mjs', 'missing-arrangement', file], { encoding: 'utf8', timeout: 15_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no arrangement missing-arrangement');
    expect(existsSync(file)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
