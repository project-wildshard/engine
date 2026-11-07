import { installAssetFixture } from './fixtures/bootSetup';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the plain pack writer's owned product fixture.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the synthetic product beneath repository tmp.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture carries the exact native section hash.
import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { lateAudioGroups } from '../scripts/app-build/audioPacks';
import { createCatalogueAudio } from '@wildshard/engine/audio/levelAudio';
import { parseAudioData } from '@wildshard/format/audio';
import * as settings from '@wildshard/engine/ui/Settings';
import source from '../src/shards/driftwood-isle/data/audioSource.json' with { type: 'json' };

await installAssetFixture();

test('native audio packs contain exactly the original late clips for every style and reject a changed section', async () => {
  const root = mkdtempSync(resolve('tmp', 'audio-pack-product-'));
  const selected = vi.spyOn(settings, 'getSfxSet').mockReturnValue('best');
  try {
    expect(await lateAudioGroups(root, 'absent')).toEqual({});
    const directory = resolve(root, 'out', 'fixture'); mkdirSync(directory, { recursive: true });
    const wire = JSON.stringify(source), hash = createHash('sha256').update(wire).digest('hex');
    writeFileSync(resolve(directory, 'audio.json'), wire);
    writeFileSync(resolve(directory, 'shard.json'), JSON.stringify({ format: 'wildshard.shardfile', formatVersion: 2, runtime: null, schemas: [], files: [],
      sections: [{ name: 'audio/audio', path: 'audio.json', bytes: Buffer.byteLength(wire), hash }] }));
    const groups = await lateAudioGroups(root, 'fixture'), profile = await createCatalogueAudio(parseAudioData(source.audio));
    for (const style of settings.MUSIC_STYLES) {
      const boot = profile.bootFiles(style), control = new Set(profile.controlFiles?.(style) ?? boot);
      expect(groups[`fixture-audio-${style}`]).toEqual([...new Set(boot)].filter(path => !control.has(path)));
      expect(groups[`fixture-audio-${style}`]?.every(path => !control.has(path))).toBe(true);
    }
    writeFileSync(resolve(directory, 'audio.json'), '{}');
    await expect(lateAudioGroups(root, 'fixture')).rejects.toThrow('differs from its product');
  } finally { selected.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});
