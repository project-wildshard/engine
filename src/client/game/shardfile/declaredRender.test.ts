// QA 11-24 row 59: a data zone's declared post look runs (Nine Dragon's rain, ink lines and live light were skipped).
import { describe, expect, test } from 'vitest';
import type { LookStrategy } from '@wildshard/engine/render/look';
import { declaredPost, withDeclaredPost } from './declaredRender';

const withRender = (render: unknown) => ({ manifest: { bindings: { render } } }) as unknown as Parameters<typeof declaredPost>[0];

describe('a data zone\'s declared post look', () => {
  test('a post binding is read from the level manifest', () => {
    expect(declaredPost(withRender({ platform: 'post', file: 'weapons/jian-row.json', field: ['look', 'post'] })))
      .toEqual({ file: 'weapons/jian-row.json', field: ['look', 'post'] });
    expect(declaredPost(withRender({ platform: 'post', file: 'look/post.json', field: [] }))).toEqual({ file: 'look/post.json', field: [] });
  });

  test('no binding, or one a data zone cannot run, keeps the data look', () => {
    expect(declaredPost({})).toBeNull();
    expect(declaredPost(withRender(undefined))).toBeNull();
    expect(declaredPost(withRender({ platform: 'painted' }))).toBeNull();
    expect(declaredPost(withRender({ module: './look.ts', export: 'default' }))).toBeNull();
    expect(declaredPost(withRender({ platform: 'post', file: 'look/post.json', field: [3] }))).toBeNull();
  });

  // QA 11-24 row 59: the post look alone fell back to an HDRI sky the data page lacks, and Nine's entry hung
  test('the post look lays its colour chain over the data look, which keeps the sky, light and ground', async () => {
    const disposed: string[] = [];
    const backdrop = (): never => { throw new Error('unused'); }, compose = (): never => { throw new Error('unused'); };
    const data = { backdrop, fog: { order: 1 }, frame: () => undefined, dispose: () => { disposed.push('data'); } } as unknown as LookStrategy;
    const post = { compose, frame: () => undefined, prepareWorld: () => Promise.resolve(), dispose: () => { disposed.push('post'); } } as unknown as LookStrategy;
    const look = await withDeclaredPost(Promise.resolve(data), Promise.resolve(post));
    expect(look.backdrop).toBe(backdrop);
    expect(Reflect.get(look, 'fog')).toEqual({ order: 1 });
    expect(Reflect.get(look, 'compose')).toBe(compose);
    expect(look.frame).toBe(post.frame);
    expect(look.prepareWorld).toBe(post.prepareWorld);
    look.dispose?.();
    expect(disposed).toEqual(['post', 'data']);
  });
});
