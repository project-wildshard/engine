// CI12 Nalati pasture raid: the raid's presentation cues, shared by the page (PagePastureRaid.nextCue) and a native tape
// (the native population's pastureCues port), map the controller's cue keys through the admitted cue rows in order.
import { expect, test } from 'vitest';
import { PastureCues } from '../src/shared/game/riding/pastureCues';

test('cue keys become the admitted rows in order, naming the cueing actor', () => {
  const cues = new PastureCues({ start: { text: 'Wolves are raiding the flock!', sound: 'howl' }, taken: { text: 'A sheep is taken', sound: null },
    drivenOff: { text: 'The wolves are driven off', sound: 'cheer' }, crack: { text: 'Crack!', sound: 'whip' } });
  cues.sink('start'); cues.sink('crack', { entityId: 'wolf-3' }); cues.sink('crack', { entityId: 'wolf-5' }); cues.sink('drivenOff');
  expect([cues.next(), cues.next(), cues.next(), cues.next(), cues.next()]).toEqual([
    { kind: 'start', text: 'Wolves are raiding the flock!', sound: 'howl', actor: null },
    { kind: 'crack', text: 'Crack!', sound: 'whip', actor: 'wolf-3' },
    { kind: 'crack', text: 'Crack!', sound: 'whip', actor: 'wolf-5' },
    { kind: 'drivenOff', text: 'The wolves are driven off', sound: 'cheer', actor: null },
    undefined,
  ]);
  expect(() => { cues.sink('howl'); }).toThrow('Missing pasture cue row');
});
