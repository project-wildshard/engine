import { expect, test } from 'vitest';
import { observeAfterBootAudio } from './afterBootAudio';

test('after-boot audio reads pending until its decode ends, however it ends', async () => {
  const audio = observeAfterBootAudio();
  expect(audio.state()).toBe('none');
  let finish = (): void => undefined;
  const running = audio.start(() => new Promise<void>(resolve => { finish = resolve; }));
  expect(audio.state()).toBe('pending');
  finish();
  await running;
  expect(audio.state()).toBe('done');
  await expect(audio.start(() => Promise.resolve())).rejects.toThrow('started twice');
  const failing = observeAfterBootAudio();
  await expect(failing.start(() => Promise.reject(new Error('decode failed')))).rejects.toThrow('decode failed');
  expect(failing.state()).toBe('done');
});
