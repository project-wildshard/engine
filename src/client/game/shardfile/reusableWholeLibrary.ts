import { Matrix4, type BufferGeometry } from 'three';
import type { App } from '@wildshard/engine/app/app';
import type { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { forgetWhenDisposed } from '@wildshard/engine/app/cachedAssets';
import { TIER } from '@wildshard/engine/core/tier';
import { readWholeGeometry } from '../plugin/geometry';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

type Assets = Pick<App['assets'], 'register' | 'acquireResource' | 'evictCached'>;
interface Template { readonly geometry: BufferGeometry; readonly matrix: readonly number[] }
interface LibraryLease {
  readonly copy: (part: string, transform: boolean) => BufferGeometry | null;
  readonly identity: (part: string) => boolean;
  readonly done: () => void;
}
const libraries = new WeakMap<Assets, Map<string, ReadonlyMap<string, Template>>>();
function requireLive(owner: Scope): void {
  if (owner.disposed || owner.disposing) throw new Error('Whole library owner is disposed or retiring');
}
function lease(owner: Scope, assets: Assets, input: ReadonlyMap<string, Template>, held: (() => void)[] = []): LibraryLease {
  requireLive(owner);
  try {
    if (held.length === 0) for (const template of input.values()) {
      const release = assets.acquireResource(template.geometry);
      if (release === null) throw new Error('Whole library geometry has retired');
      held.push(release);
    }
  } catch (error) { for (const release of held) release(); throw error; }
  let views: ReadonlyMap<string, Template> | undefined = input;
  let forget = (): void => undefined;
  const done = (): void => {
    if (views === undefined) return;
    views = undefined; forget(); for (const release of held.splice(0)) release();
  };
  forget = owner.capture('disposers', done);
  const view = (part: string): Template | undefined => {
    requireLive(owner);
    if (views === undefined) throw new Error('Whole library construction has finished');
    return views.get(part);
  };
  return { done, identity: part => {
    const template = view(part);
    return template?.matrix.every((value, i) => value === (i % 5 === 0 ? 1 : 0)) === true;
  }, copy: (part, transform) => {
    const template = view(part); if (template === undefined) return null;
    const geometry = template.geometry.clone();
    return transform ? geometry.applyMatrix4(new Matrix4().fromArray(template.matrix)) : geometry;
  } };
}

/** Completed partition reconstructions only: source hashes and tier identify geometry plus detached matrix words.
 * The original admitted decoder runs on a miss; no pending owner or decoder cleanup enters this memo. */
export async function readReusableWholeLibrary(owner: Scope, product: ShardFolder, files: readonly string[], assets: Assets, pause?: () => Promise<void>): Promise<LibraryLease> {
  requireLive(owner);
  let memo = libraries.get(assets);
  if (memo === undefined) { memo = new Map(); libraries.set(assets, memo); }
  const key = JSON.stringify([files, TIER]), ready = memo.get(key);
  if (ready !== undefined) {
    const held = lease(owner, assets, ready);
    try {
      // A decoded hit still releases this admission's transport through its original authority.
      const { runtimeFolder } = await import('./runtimeFolder');
      const runtime = runtimeFolder(product.shardfile);
      await runtime.releaseTransport(files); runtime.assets.releaseTiles();
      requireLive(owner);
      return held;
    } catch (error) { held.done(); throw error; }
  }
  const decoder = owner.child('whole-decoder'), registered: string[] = [], held: (() => void)[] = [];
  const unclaimed = new Set<BufferGeometry>();
  try {
    const decoded = await readWholeGeometry(decoder, product.shardfile, files, pause);
    requireLive(owner);
    const winner = memo.get(key);
    if (winner !== undefined) { decoder.dispose(); return lease(owner, assets, winner); }
    for (const view of decoded.values()) { view.release?.(); unclaimed.add(view.geometry); }
    decoder.dispose();
    const built = new Map<string, Template>();
    for (const [part, view] of decoded) {
      const id = `scene:${view.geometry.uuid}`;
      withOwner(owner, () => assets.register(id, view.geometry, { retain: true, cache: true, reusable: true }));
      registered.push(id); unclaimed.delete(view.geometry);
      const release = assets.acquireResource(view.geometry);
      if (release === null) throw new Error('Whole library geometry has no owner');
      held.push(release);
      built.set(part, { geometry: view.geometry, matrix: view.matrix.elements.slice() });
    }
    const result = lease(owner, assets, built, held);
    if (built.size === 0) return result;
    memo.set(key, built);
    // its listener holds no product or owner of this reader
    forgetWhenDisposed(new Map([...built].map(([id, view]) => [id, view.geometry])), memo, key, built);
    return result;
  } catch (error) {
    decoder.dispose();
    for (const release of held.splice(0)) release();
    for (const id of registered) assets.evictCached(id);
    for (const geometry of unclaimed) geometry.dispose();
    throw error;
  }
}
