import { expect, test, vi } from 'vitest';
import * as tables from '@wildshard/engine/boot/tables';
import { cueFile, cueFiles, CueCatalogue } from '@wildshard/engine/audio/Cues';
import { pcmBuffer } from './engine/audio/pcm-buffer';

test('a shared loop reads the canonical shipped recording once with native metadata', async () => {
  const reference = { set: 'coastal', file: 'surf.m4a' };
  const manifests = vi.spyOn(tables, 'sfxManifests').mockReturnValue({
    coastal: { beds: { surf: { file: 'surf.m4a', loopStart: 0, loopEnd: 1 } } },
    harbour: { beds: { sea: { file: reference, loopStart: 0, loopEnd: 1, gain: 0.6 },
      wind: { file: reference, loopStart: 0, loopEnd: 1, gain: 0.4 } } },
  });
  const bytes = vi.spyOn(tables, 'publicBytes').mockReturnValue({ '/assets/sfx/coastal/surf.m4a': 100 });
  const read = vi.fn<(url: string) => Promise<ArrayBuffer>>(() => Promise.resolve(new ArrayBuffer(100)));
  const decode = vi.fn<() => Promise<AudioBuffer>>(() => Promise.resolve(pcmBuffer(48000)));
  const catalogue = new CueCatalogue('harbour', read, decode);
  try {
    expect(cueFiles('harbour')).toEqual(['/assets/sfx/coastal/surf.m4a']);
    const bank = await catalogue.decodeAll();
    expect(read.mock.calls).toEqual([['/assets/sfx/coastal/surf.m4a']]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect([...bank.loops.keys()]).toEqual(['bed.sea', 'bed.wind']);
    expect(bank.loops.get('bed.sea')?.gain).toBe(0.6);
    expect(bank.loops.get('bed.wind')?.gain).toBe(0.4);
    for (const invalid of [{ set: '../coastal', file: 'surf.m4a' }, { set: 'missing', file: 'surf.m4a' },
      { set: 'coastal', file: '../surf.m4a' }, { set: 'coastal', file: 'unlisted.m4a' },
      { set: 'coastal', file: reference }, { ...reference, fallback: 'other.m4a' }]) {
      expect(cueFile('harbour', invalid)).toBeUndefined();
    }
    bytes.mockReturnValue({});
    expect(cueFile('harbour', reference)).toBeUndefined();
  } finally { catalogue.dispose(); manifests.mockRestore(); bytes.mockRestore(); }
});
