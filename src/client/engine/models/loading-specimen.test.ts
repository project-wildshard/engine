// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { Group } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { loadingSpecimen } from './gear';
import { specimenReady } from './model';

test('a failed cold specimen keeps its placeholder but refuses readiness', async () => {
  const owner = new Scope('failed-specimen'), warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const failure = new Error('Invalid specimen bytes');
    const root = loadingSpecimen('failure', [1, 1, 1], () => Promise.reject(failure), owner);
    const placeholder = root.children[0];
    await expect(specimenReady(root)).rejects.toBe(failure);
    expect(root.children).toEqual([placeholder]); expect(warn).toHaveBeenCalledOnce();
  } finally { owner.dispose(); warn.mockRestore(); }
});

test('successful cold specimen readiness follows replacement of the placeholder', async () => {
  const owner = new Scope('ready-specimen'), made = new Group();
  try {
    const root = loadingSpecimen('ready', [1, 1, 1], () => Promise.resolve(made), owner);
    await specimenReady(root); expect(root.children).toEqual([made]);
  } finally { owner.dispose(); }
});
