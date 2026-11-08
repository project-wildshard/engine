// CI12 Nalati wolves: the wild groups' notices, split out of bindPageGroups (GroupNotices, renderer-free), raise the same text
// at the same moments as the page's inline toast law (a cooldown per signal, one for knockdowns), and continue exactly from
// their checkpoint.
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { PopulationEffectsSchema } from '@wildshard/format/creatures';
import { GroupNotices } from '../src/shared/game/population/groupNotices';

const effects = v.parse(PopulationEffectsSchema, { notices: [{ signal: 'howl', text: 'The wolves howl in the hills', every: 20 }, { signal: 'raid', text: 'Wolves at the flock!', every: 6 }],
  knockdown: { speed: 9, min: 2, max: 6, seconds: .6, text: 'Knocked down!', every: 3 } });

/** bindPageGroups' toast law before the split (pageGroups.ts, before CI12) */
function inline() {
  const lastNotice = new Map<string, number>(), toasts: string[] = [];
  const toast = (key: string, text: string, every: number, now: number): void => { if (now - (lastNotice.get(key) ?? -1e9) < every) return; lastNotice.set(key, now); toasts.push(text); };
  return { toasts, signal: (name: string, now: number): void => { const notice = effects.notices.find(row => row.signal === name); if (notice !== undefined) toast(name, notice.text, notice.every, now); },
    knockdown: (now: number): void => { toast('knockdown', effects.knockdown.text, effects.knockdown.every, now); } };
}

test('the notices raise as the page toasted, and continue from their checkpoint', () => {
  const old = inline(), notices = new GroupNotices(effects), got: string[] = [];
  let copy: GroupNotices | null = null; const copied: string[] = [], fromCopy: string[] = [];
  const events = ['howl', 'raid', 'bleat', 'knockdown', 'howl', 'raid'];
  for (let f = 0; f < 2000; f++) {
    const now = f * .25, event = events[(f * 7 + Math.floor(f / 13)) % events.length] ?? 'howl';
    if (event === 'knockdown') old.knockdown(now); else old.signal(event, now);
    const text = event === 'knockdown' ? notices.knockdown(now) : notices.signal(event, now); if (text !== null) got.push(text);
    if (copy !== null) { const c = event === 'knockdown' ? copy.knockdown(now) : copy.signal(event, now); if (c !== null) fromCopy.push(c); if (text !== null) copied.push(text); }
    if (f === 777) { copy = new GroupNotices(effects); copy.restore(notices.snapshot()); }
  }
  expect(got).toEqual(old.toasts); expect(fromCopy).toEqual(copied);
  expect(new Set(got)).toEqual(new Set(['The wolves howl in the hills', 'Wolves at the flock!', 'Knocked down!']));
});
