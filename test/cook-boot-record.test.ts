// Meta QA 11-24 row 43 (MA13, SHARD-COMPAT SP1b5b): the box cook runs `serve`, never `recook`, so its record pass has to
// run on boot, before the boot recook, or a render change cooks every head stale. The poll still starts at once: a new
// upload never waits behind the record pass.
import {expect, it} from 'vitest';
import {bootCook} from '../src/cook/game/cookWorker';

it('the boot recook waits for the record pass; the poll does not', async () => {
  const order: string[] = [];
  let finish = (): void => undefined;
  const before = new Promise<void>(done => { finish = () => { order.push('recorded'); done(); }; });
  let poll: ReturnType<typeof bootCook>['poll'] | undefined;
  const booted = bootCook({
    recook: () => { order.push('recook'); return Promise.resolve([]); },
    sweep: () => { order.push('sweep'); poll?.stop(); return Promise.resolve([]); },
  }, {before, wait: () => Promise.resolve()});
  poll = booted.poll;
  poll.stop();
  await booted.poll.done;
  expect(order).toEqual(['sweep']);
  finish();
  await booted.recooked;
  expect(order).toEqual(['sweep', 'recorded', 'recook']);
});

it('a failed record pass still recooks, stale', async () => {
  const lines: string[] = [], recooks: string[] = [];
  const booted = bootCook({recook: () => { recooks.push('recook'); return Promise.resolve([]); }, sweep: () => Promise.resolve([])},
    {before: Promise.reject(new Error('canary refused')), log: line => { lines.push(line); }, wait: () => new Promise(() => undefined)});
  await booted.recooked;
  booted.poll.stop();
  expect(recooks).toEqual(['recook']);
  expect(lines).toContain('record pass failed, recooking stale: Error: canary refused');
});
