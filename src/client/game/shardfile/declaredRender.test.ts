// QA 11-24 row 59: a data zone's declared post look runs (Nine Dragon's rain, ink lines and live light were skipped).
import { describe, expect, test } from 'vitest';
import { declaredPost } from './declaredRender';

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

});
