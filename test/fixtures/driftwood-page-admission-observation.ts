import { PAGE_LIFE } from '../../src/shards/driftwood-isle/generators/pageLife';
import { PAGE_STORY } from '../../src/shards/driftwood-isle/generators/pageStory';
import { CHAPTER_DIRECTOR } from '../../src/shards/driftwood-isle/generators/chapterDirector';
import { DRIFTWOOD_NATIVE_QUEST } from '../../src/shards/driftwood-isle/generators/nativeQuest';
import { hashImmutableBytes } from '../../src/shared/host/immutable';

/** Complete authored page lifetime/story/director/mechanics wires, independent of product publication. */
export function driftwoodPageAdmissionObservation() {
  return Object.entries({ life: PAGE_LIFE, story: PAGE_STORY, director: CHAPTER_DIRECTOR, native: DRIFTWOOD_NATIVE_QUEST }).map(([name, row]) => {
    const bytes = new TextEncoder().encode(JSON.stringify(row)); return { name, bytes: bytes.length, hash: hashImmutableBytes(bytes) };
  });
}
