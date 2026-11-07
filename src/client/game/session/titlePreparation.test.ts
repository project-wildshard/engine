import { expect, test } from 'vitest';
import { observeTitlePreparation, prepareTitleFrame } from './titlePreparation';

function deferred(): { promise: Promise<void>; finish: () => void; fail: (error: Error) => void } {
  let finish = (): void => { throw new Error('Uninitialized resolver'); };
  let fail = (_error: Error): void => { throw new Error('Uninitialized rejection'); };
  const promise = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  return { promise, finish, fail };
}

test('a visible title must retain each independently unfinished warm owner', async () => {
  const shaders = deferred(), firstFrame = deferred();
  const owner = observeTitlePreparation(shaders.promise, firstFrame.promise);
  expect(owner.state()).toEqual({ pending: ['shaders', 'first-world-frame'], issue: null });
  shaders.finish(); await shaders.promise;
  expect(owner.state()).toEqual({ pending: ['first-world-frame'], issue: null });
  firstFrame.finish(); await firstFrame.promise;
  expect(owner.state()).toEqual({ pending: [], issue: null });
});

test('the first draw cannot hide pending shader compilation or its original failure', async () => {
  const shaders = deferred();
  const owner = observeTitlePreparation(shaders.promise, Promise.resolve());
  await Promise.resolve();
  expect(owner.state().pending).toEqual(['shaders']);
  shaders.fail(new Error('Original compile failure')); await Promise.resolve();
  expect(owner.state()).toEqual({ pending: [], issue: 'Original compile failure' });
});

function frameOwner(): {
  port: Parameters<typeof prepareTitleFrame>[0];
  delay: () => number; fire: () => void; tick: () => void; draw: () => void;
  dispose: () => void; skip: () => void; primes: () => number;
} {
  let delay = 0, frames = 10, primes = 0, disposed = false, skipped = false;
  let fire = (): void => { throw new Error('No scheduled timer'); };
  let cleanup = (): void => { throw new Error('No registered cleanup'); };
  const raf: (() => void)[] = [];
  return {
    port: { later: (ms, run) => { delay = ms; fire = run; }, next: run => { raf.push(run); },
      onDispose: run => { cleanup = run; }, disposed: () => disposed, skip: () => skipped,
      frame: () => frames, prime: () => { primes++; } },
    delay: () => delay, fire: () => { fire(); },
    tick: () => { const run = raf.shift(); if (run === undefined) throw new Error('No scheduled frame'); run(); },
    draw: () => { frames++; }, dispose: () => { disposed = true; cleanup(); },
    skip: () => { skipped = true; }, primes: () => primes,
  };
}

test('the unchanged 1200 ms prime reserves completion until a real draw follows it', async () => {
  const fake = frameOwner();
  const work = prepareTitleFrame(fake.port), owner = observeTitlePreparation(Promise.resolve(), work);
  expect(fake.delay()).toBe(1200);
  fake.draw(); fake.fire(); await Promise.resolve();
  expect(fake.primes()).toBe(1);
  fake.tick(); await Promise.resolve();
  expect(owner.state().pending).toEqual(['first-world-frame']);
  fake.draw(); fake.tick(); await work;
  expect(owner.state().pending).toEqual([]);
  expect(fake.primes()).toBe(1);
});

test('entering or exploring before the delayed prime completes without another draw', async () => {
  const fake = frameOwner();
  const work = prepareTitleFrame(fake.port);
  fake.skip(); fake.fire(); await work;
  expect(fake.primes()).toBe(0);
});

test('scope retirement releases the observation before the delayed prime', async () => {
  const fake = frameOwner();
  const work = prepareTitleFrame(fake.port);
  fake.dispose(); await work;
  fake.fire();
  expect(fake.primes()).toBe(0);
});

test('scope retirement also releases an already primed draw', async () => {
  const fake = frameOwner();
  const work = prepareTitleFrame(fake.port);
  fake.fire(); fake.dispose(); await work;
  fake.tick();
  expect(fake.primes()).toBe(1);
});
