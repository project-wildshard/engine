import { installAssetFixture } from './fixtures/bootSetup';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the plain pack writer's owned product fixture.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the synthetic product beneath repository tmp.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture carries the exact native section hash.
import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { lateAudioGroups } from '../src/scripts/app-build/audioPacks';
import { createCatalogueAudio } from '@wildshard/engine/audio/levelAudio';
import { parseAudioData } from '@wildshard/format/audio';
import * as settings from '@wildshard/engine/ui/Settings';
import { ENGINE_MUSIC_STYLE } from '@wildshard/engine/audio/bootAudio';

const source = { audio: {
  cues: [],
  music: { id: 'fixture.score', base: 'island', slots: ['island', 'pine'], bootSlots: ['title', 'island', 'pine'], controlTension: 'late',
    lifecycle: { persistent: false, dispose: true, logChanges: false }, synthLead: 'marimba', minFade: 0, source: null,
    sets: { island: 'base', pine: 'base' }, selection: [{ slots: ['island'], when: [] }], selectMode: 'first',
    catalogue: { mode: 'bank', extraStings: [], stingSets: {} } },
  samples: { bed: 'fixture', set: 'fixture', loopGains: { fixture: 0.5 },
    catalogue: { inventoryOmitSlots: [], loopOrder: ['fixture'], overlaySamples: true, ownMusic: false, priorityOwn: false } },
  score: 'default', routing: [],
  ambience: null,
} };

await installAssetFixture();

test('native audio packs contain exactly the original late clips of the one style and reject a changed section', async () => {
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
    const style = ENGINE_MUSIC_STYLE, boot = profile.bootFiles(style), control = new Set(profile.controlFiles?.(style) ?? boot);
    const late = [...new Set(boot)].filter(path => !control.has(path));
    expect(late.length).toBeGreaterThan(0);
    expect(groups).toEqual({ [`fixture-audio-${style}`]: late });
    writeFileSync(resolve(directory, 'audio.json'), '{}');
    await expect(lateAudioGroups(root, 'fixture')).rejects.toThrow('differs from its product');
  } finally { selected.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});
