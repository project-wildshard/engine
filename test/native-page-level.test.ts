// QA 11-25 row 52 (FORMAT-PRUNE FP47b, J505): SDK 0.4.32 on builds a discovery document with no level look (sky,
// atmosphere, grade, horizon); the product keeps it in `look/look` (`look.level`). Nalati on SDK 0.4.34 never entered:
// its runtime page read discovery alone, drew the plain sky with no HDRI, and its sky rig refused at level.world. Every
// live pin (J507: read by slug, never a stored copy) is rebuilt here as the newest SDK writes it, and its page must draw
// the look its pin draws today.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the live pin list.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nativePageLevel, type LevelLookSource } from '../src/client/game/shardfile/declaredLook';
import { PLAIN_LEVEL_LOOK, type ShardManifest } from '../src/client/game/shard/manifest';
import { liveMount, liveSection } from './fixtures/livePin';

type Look = Pick<ShardManifest, 'sky' | 'atmosphere' | 'grade' | 'horizon'>;
const pins = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string }[] }).shards.map(row => row.slug);

function discoveryLook(slug: string): Partial<Look> {
  const { data } = liveMount(slug, `shardfiles/${slug}/discovery.json`) as { data: Partial<Look> };
  return data;
}

describe('a runtime page draws its product\'s level look on the newest SDK', () => {
  it('names the live pins', () => expect(pins).toContain('nalati-grasslands'));

  for (const slug of pins) {
    it(slug, () => {
      // what the pin's runtime page drew before: its discovery document's level look
      const source = liveSection(slug, 'look/look') as LevelLookSource, today = discoveryLook(slug);
      if (today.sky === undefined) return; // built on the newest SDK already: nothing older to match
      // the newest SDK's discovery carries none, so the engine starts from the plain one (`defineAuthoredShard`); a product
      // with no level manifest (the open plots, Mirror Salt) gets its discovery's look lifted into `look.level`
      const { sky, atmosphere, grade, horizon } = today;
      const level = source.look.level ?? { sky, atmosphere, grade, ...(horizon === undefined ? {} : { horizon }) };
      const newest = nativePageLevel({ ...PLAIN_LEVEL_LOOK }, { ...source, look: { ...source.look, level } as LevelLookSource['look'] });
      expect(newest.sky).toEqual(today.sky);
      expect(newest.atmosphere).toEqual(today.atmosphere);
      expect(newest.grade).toEqual(today.grade);
      if (today.horizon !== undefined) expect(newest.horizon).toEqual(today.horizon);
      // the HDRI rig needs level.sky.hdri: a zone whose pin names one keeps it
      if (today.sky.hdri !== undefined) expect(newest.sky.hdri).toBe(today.sky.hdri);
    });
  }

  it('reads discovery when the product declares no level look', () => {
    const sky = { ...PLAIN_LEVEL_LOOK.sky, hdri: 'made-up-sky' };
    expect(nativePageLevel({ ...PLAIN_LEVEL_LOOK, sky }, { look: {} }).sky.hdri).toBe('made-up-sky');
  });
});
