import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { realGc } from '../src/test/engine/realGc';
import { emptyShardfile } from '../src/shared/host/author';
import { shardProductFromAdmission } from '../src/client/game/shardfile/runtimeProduct';
import type { ProductOptions } from '../src/client/game/shardfile/product';

test('a live admission reader keeps its facade and transport across collection', async () => {
  await realGc('test/runtime-product-lifetime.test.ts', 'a live admission reader keeps', async collect => {
    const source = emptyShardfile({ slug: 'live-admission', name: 'Live', author: 'Test', revision: 1, seed: 1 });
    const options: ProductOptions = { base: 'https://test.example/shardfiles/live-admission/', offline: true, firstParty: true,
      hash: () => Promise.reject(new Error('Unexpected hash')), fetch: () => Promise.reject(new Error('Unexpected fetch')) };
    const scope = new Scope('live-admission');
    try {
      const held = (() => {
        const wire = new Uint8Array([7, 8, 9]), admitted = { source, assets: new Map([['live-wire', wire]]), cached: false };
        return { product: shardProductFromAdmission(admitted, scope, options), wire: new WeakRef(wire) };
      })();
      await collect(new WeakRef({ marker: 'unowned' }));
      expect(shardProductFromAdmission({ source, assets: new Map(), cached: false }, scope, options)).toBe(held.product);
      expect(held.product.shardfile).toBe(source);
      expect(held.wire.deref()).toEqual(new Uint8Array([7, 8, 9]));
      expect(scope.disposed).toBe(false);
    } finally { scope.dispose(); }
  });
});

test('a live descriptor does not retain a retired admission facade or its transport', async () => {
  await realGc('test/runtime-product-lifetime.test.ts', 'a live descriptor does not retain', async collect => {
    const source = emptyShardfile({ slug: 'retired-admission', name: 'Retired', author: 'Test', revision: 1, seed: 1 });
    const options: ProductOptions = { base: 'https://test.example/shardfiles/retired-admission/', offline: true, firstParty: true,
      hash: () => Promise.reject(new Error('Unexpected hash')), fetch: () => Promise.reject(new Error('Unexpected fetch')) };
    const retired = (() => {
      const scope = new Scope('retired-admission'), wire = new Uint8Array(1024 * 1024);
      const admitted = { source, assets: new Map([['retired-wire', wire]]), cached: false };
      const product = shardProductFromAdmission(admitted, scope, options);
      expect(shardProductFromAdmission(admitted, scope, options)).toBe(product);
      scope.dispose();
      return { product: new WeakRef(product), backing: new WeakRef(wire.buffer) };
    })();
    await collect(retired.product);
    await collect(retired.backing);
    // Keep the original descriptor/key alive throughout collection and reuse it.
    const next = new Scope('next-admission');
    try {
      const admitted = { source, assets: new Map<string, Uint8Array>(), cached: false };
      const product = shardProductFromAdmission(admitted, next, options);
      expect(product.shardfile).toBe(source);
      expect(shardProductFromAdmission(admitted, next, options)).toBe(product);
    } finally { next.dispose(); }
  });
});
