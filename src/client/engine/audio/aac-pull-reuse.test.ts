// oxlint-disable-next-line import/no-nodejs-modules -- Reads a shipped AAC recording for the native pull fixture.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { indexRecordingAac } from '@wildshard/format/aacIndex';
import { parseManifest } from '../../../shared/engine/audio/bootAudio';
import { AacPull, AAC_WINDOW_FRAMES, type AacCodecFactory } from './aacPull';
import { Scope } from '../../../shared/engine/app/scope';

// mini-memstruct-m3b: steady AAC streaming makes no PCM garbage. A walk's two streams made ~1.5 MB/s of typed arrays,
// half of WebKit's high-mode walk peak; the pull now recycles its packet planes and answers in its own scratch.
it('recycles packet planes and answers every read in the same scratch planes', async () => {
  const raw: unknown = JSON.parse(readFileSync('public/assets/music/piano/music.json', 'utf8'));
  const spec = parseManifest(raw)?.slots['title'];
  if (!spec) throw new Error('Missing tracked title score');
  const bytes = new Uint8Array(readFileSync(`public/assets/music/piano/${spec.calm}`));
  const index = indexRecordingAac(bytes), planes = new Set<ArrayBufferLike>();
  let packet = 0;
  const factory: AacCodecFactory = output => ({
    decode: () => { const value = ++packet; output({ numberOfFrames: 1024, numberOfChannels: index.channels, sampleRate: 48000,
      copyTo: (target, options) => { planes.add(target.buffer); target.fill(value + options.planeIndex); }, close: () => undefined }); },
    flush: () => Promise.resolve(), close: () => undefined,
  });
  const scope = new Scope('aac-pull-reuse'), pull = new AacPull(bytes, index, factory, scope);
  try {
    const answers = new Set<ArrayBufferLike>();
    let start = 0;
    for (let window = 0; window < 40; window++) {
      const pcm = await pull.read(start, AAC_WINDOW_FRAMES);
      expect(pcm).toHaveLength(index.channels);
      for (const plane of pcm) { expect(plane.length).toBe(AAC_WINDOW_FRAMES); answers.add(plane.buffer); }
      // the samples are the decoder's, in order: a read starts where the last one ended
      expect(pcm[0]?.[AAC_WINDOW_FRAMES - 1]).toBeGreaterThan(0);
      start += AAC_WINDOW_FRAMES;
    }
    expect(packet).toBeGreaterThan(900);
    // forty half-second windows read through one scratch plane per channel, and a handful of packet planes
    expect(answers.size).toBe(index.channels);
    expect(planes.size).toBeLessThanOrEqual(10 * index.channels);
  } finally { scope.dispose(); }
});
