import { expect, test } from 'vitest';
import type { SimHost } from '@wildshard/engine/sim';
import { publishShardState } from '@wildshard/engine/sim/shardRows';
import { Flags } from '@wildshard/engine/world/interact/flags';
import { FIELD_GAP_MS, PROGRESS_GAP_MS, ProgressSaves, ProgressWatch, RETRY_MS } from './progressWatch';

// TE-ENG8: what the solo server's save-on-progress watch sees, and when it saves.
function host(): { host: SimHost; flags: Flags; field: { value: number } } {
  const flags = new Flags('progress-watch', false), field = { value: 0 }, made = { flags, scope: { onDispose: () => undefined } };
  publishShardState(made, () => [{ name: 'door.open', value: field.value }]);
  // the watch reads only a host's flags and its published rows
  return { host: made as unknown as SimHost, flags, field };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('the boot look takes where the world stands; a flag, a grant or a crossing after it is progress, a field alone is a field', () => {
  const watch = new ProgressWatch(), a = host(), b = host();
  a.flags.set('dead:old');
  expect(watch.look(a.host, 3)).toBe('none'); // boot, before the first tick
  a.flags.set('dead:wolf'); // the first tick's kill
  expect(watch.look(a.host, 3)).toBe('progress');
  expect(watch.look(a.host, 4)).toBe('progress'); // a grant
  a.field.value = 1;
  expect([watch.look(a.host, 4), watch.look(a.host, 4)]).toContain('field'); // fields are read every other tick
  expect(watch.look(b.host, 4)).toBe('progress'); // a crossing
  a.flags.set('dead:bear');
  expect(watch.look(b.host, 4)).toBe('none'); // the old host is let go
});

test('saves wait the short gap for progress and the long one for a field, one at a time', async () => {
  const at: number[] = [];
  let now = 0;
  const saves = new ProgressSaves(() => { at.push(now); return Promise.resolve(true); });
  saves.moved(now, 'progress'); saves.poll(now); await settle();
  expect(at).toEqual([0]);
  now = 10; saves.moved(now, 'progress'); saves.poll(now); await settle();
  now = PROGRESS_GAP_MS - 1; saves.poll(now); await settle();
  expect(at).toEqual([0]);
  now = PROGRESS_GAP_MS; saves.poll(now); await settle();
  expect(at).toEqual([0, PROGRESS_GAP_MS]);
  saves.moved(now, 'field'); now += PROGRESS_GAP_MS; saves.poll(now); await settle();
  expect(at).toHaveLength(2);
  now = PROGRESS_GAP_MS + FIELD_GAP_MS; saves.poll(now); await settle();
  expect(at).toHaveLength(3);
  expect(saves.pending).toBe(false);
});

test('a save the storage refused stays owed and is tried again', async () => {
  const answers = [false, true], tried: number[] = [];
  let now = 0;
  const saves = new ProgressSaves(() => { tried.push(now); return Promise.resolve(answers.shift() ?? true); });
  saves.moved(now, 'progress'); saves.poll(now); await settle();
  expect(saves.pending).toBe(true);
  now = RETRY_MS - 1; saves.poll(now); await settle();
  expect(tried).toEqual([0]);
  now = RETRY_MS; saves.poll(now); await settle();
  expect(tried).toEqual([0, RETRY_MS]);
  expect(saves.pending).toBe(false);
});
