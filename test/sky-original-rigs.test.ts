// oxlint-disable-next-line import/no-nodejs-modules -- Exercise a clean oracle root, corrupt input refusal and detached loans.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine the independent fixture root to repository scratch.
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { originalSkyRigs } from './fixtures/sky-original-rigs';
import { hashImmutableBytes } from '../src/shared/host/immutable';

test('complete original rig oracles work with neither retired handoff and reject corrupted frozen bytes', () => {
  const root = mkdtempSync(resolve('tmp/sky-original-rigs-'));
  const paths = ['test/fixtures/sky-rigs/storm-roc.glb', 'test/fixtures/sky-rigs/sky-goat.glb',
    'public/assets/far-reach/rigs/drift-ray.glb', 'public/assets/far-reach/rigs/gale-wisp.glb',
    'public/assets/gpu/far-reach/rigs/storm-roc-70e5655f.glb'];
  try {
    for (const path of paths) {
      const file = resolve(root, path); mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, readFileSync(path));
    }
    for (const name of ['storm-roc', 'sky-goat']) expect(existsSync(resolve(root, `public/assets/far-reach/rigs/${name}.glb`))).toBe(false);
    const original = originalSkyRigs(root), pins = [...original].map(([name, bytes]) => [name, bytes.length, hashImmutableBytes(bytes)]);
    expect(original.size).toBe(5);
    for (const bytes of original.values()) bytes.fill(0);
    expect([...originalSkyRigs(root)].map(([name, bytes]) => [name, bytes.length, hashImmutableBytes(bytes)])).toEqual(pins);
    const file = resolve(root, 'test/fixtures/sky-rigs/storm-roc.glb'), corrupt = readFileSync(file);
    corrupt[0] = 0; writeFileSync(file, corrupt);
    // Keep the same length so the full predecessor hash must catch corruption.
    expect(() => originalSkyRigs(root)).toThrow('Original Sky rig differs: storm-roc.glb');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
