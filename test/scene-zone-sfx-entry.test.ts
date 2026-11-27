// @vitest-environment happy-dom
// Standalone shardfiles SF11: an open plot's scene enters through the client plan's audio.scene play install, which calls
// enterClientAudioScene directly. The zone's own sfx set (its cue bank and credit) is no longer in the build's tables, so
// that entry adopts it from the zone's parts before the scene binds; else level.play refused "Scene cue bank requires its
// credit" (nightly-heads groups 3 and 4, the eight open plots).
import {expect, test, vi} from 'vitest';

const order: string[] = [];
vi.mock('../src/client/game/shardfile/audioCatalogue', () => ({
  adoptCookedSfx: vi.fn((slug: string, set: string) => { order.push(`adopt ${slug} ${set}`); return Promise.resolve(); }),
}));

test("the plot scene path adopts the zone's own sfx set before the scene reads it", async () => {
  const {enterClientAudioScene} = await import('../src/client/game/audio/sceneDirector');
  const ctx = {game: {declaredAudio: {samples: {set: 'example'}}}, product: {slug: 'open-plot-example', shardfile: {audio: {}}},
    scope: {disposed: false, disposing: false}};
  // this made-up context has no scene and no play owner, so the entry refuses after the adoption
  await expect(enterClientAudioScene(ctx as never)).rejects.toThrow();
  expect(order).toEqual(['adopt open-plot-example example']);
  // a scope that ended while the set was read enters nothing
  order.length = 0;
  await expect(enterClientAudioScene({...ctx, scope: {disposed: true, disposing: false}} as never)).resolves.toBeUndefined();
  expect(order).toEqual(['adopt open-plot-example example']);
});
