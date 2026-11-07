// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the native loader's real renderer refusal.
import { execFileSync } from 'node:child_process';
import { prepareNativeCoinRecipe } from './fixtures/native-coin-recipe';
import { expect, test } from 'vitest';
import { Scene, Vector3 } from 'three';
import { app } from '../src/client/engine/app/runtime';
import { RngService } from '../src/shared/engine/core/rng';
import { installCoinModel } from '../src/client/game/loot/coinModel';
import { coinGeometry } from '../src/client/game/generators/pickups';
import { CoinMotion } from '../src/client/game/loot/CoinMotion';
import { CoinBurst } from '../src/client/game/loot/CoinBurst';
import { Purse } from '../src/shared/game/loot/Purse';
import { Owned } from '../src/shared/game/loot/Owned';
import { Bounty } from '../src/shared/game/loot/Bounty';
import { ownedSave, bountySave } from '../src/shared/game/saves';

function play(burst: CoinBurst) {
  const events: string[] = [], frames: number[][] = [];
  const at = new Vector3(3, 4, 5), player = new Vector3(1, 2, 3);
  for (let i = 0; i < 5; i++) burst.spawn(at, 25, n => { events.push(`coin:${i}:${n}`); }, () => { events.push(`done:${i}`); });
  for (let i = 0; i < 200; i++) {
    player.x = i < 30 ? 1 : 100;
    burst.update(1 / 60, player);
    const values = burst.mesh.instanceMatrix.array;
    frames.push([burst.inFlight, burst.mesh.count, ...new Uint32Array(values.buffer, values.byteOffset, values.length)]);
  }
  return { events, frames };
}

test('a native cosmetic stream matches every page burst word, draw and callback through pool overflow', async () => {
  installCoinModel(coinGeometry);
  const saved = app.rng.snapshot(), local = new RngService(710);
  const page = new CoinBurst(new Scene()); let calls = 0;
  const geometry = await prepareNativeCoinRecipe();
  const original = coinGeometry(0xc01), decoded = geometry(0xc01);
  try {
    expect(Object.keys(decoded.attributes)).toEqual(Object.keys(original.attributes));
    for (const key of Object.keys(original.attributes)) {
      const expected = original.getAttribute(key), actual = decoded.getAttribute(key);
      expect(actual.itemSize).toBe(expected.itemSize); expect(actual.normalized).toBe(expected.normalized);
      expect(actual.array).toEqual(expected.array);
    }
    expect(decoded.index?.array).toEqual(original.index?.array);
  } finally { original.dispose(); decoded.dispose(); }
  installCoinModel(geometry);
  const native = new CoinMotion(new Scene(), () => { calls++; return local.stream('cosmetic').next(); });
  try {
    expect(calls).toBe(0); expect(local.snapshot().streams).toEqual([]);
    app.rng.seed(710);
    const expected = play(page), wantedRng = app.rng.snapshot();
    const actual = play(native);
    expect(actual).toEqual(expected);
    expect(local.snapshot()).toEqual(wantedRng);
    expect(calls).toBe(5 + 48 * 5);
    expect(actual.events.filter(value => value.startsWith('coin:')).length).toBe(60);
    expect(actual.events.filter(value => value.startsWith('done:')).length).toBe(5);
    expect(actual.frames.at(-1)?.slice(0, 2)).toEqual([0, 0]);
  } finally { page.dispose(); native.dispose(); app.rng.restore(saved); }
});

test('owned continuation storage preserves page filtering, writes and notifications', () => {
  const id = 'continuation-owned';
  const original = ownedSave.read(id);
  let durable = { owned: ['cape', 'whetstone-1', 'not-an-item'], worn: ['cape', 'heart-1'] };
  const writes: string[] = [], events: string[] = [];
  try {
    ownedSave.write(structuredClone(durable), id);
    const page = new Owned(id), native = new Owned(`chunk://local/${id}`, {
      read: slug => { expect(slug).toBe(id); return structuredClone(durable); },
      write: (value, slug) => { expect(slug).toBe(id); durable = structuredClone(value); writes.push(JSON.stringify(value)); return true; },
    });
    page.onChange(() => { events.push('page'); }); native.onChange(() => { events.push('native'); });
    expect(native.all).toEqual(page.all); expect(native.worn('cape')).toBe(true);
    expect(native.grant('heart-1')).toBe(page.grant('heart-1'));
    expect(native.grant('heart-1')).toBe(page.grant('heart-1'));
    native.takeOff('cape'); page.takeOff('cape');
    native.wear('cape'); page.wear('cape');
    native.revoke('cape'); page.revoke('cape');
    expect(durable).toEqual(ownedSave.read(id));
    expect(events).toEqual(['native', 'page', 'native', 'page', 'native', 'page', 'native', 'page']);
    expect(writes).toHaveLength(4);
    expect(() => native.grant('unknown')).toThrow('Unknown owned identity');
  } finally { ownedSave.write(original, id); }
});

test('bounty continuation storage keeps the original paid slots and late-kind cap', () => {
  const id = 'continuation-bounty', original = bountySave.read(id);
  let durable: Record<string, number> = { 'crab:2': 1 };
  const targets = [{ kind: 'crab', herd: 2, alive: true }, { kind: 'crab', herd: 2, alive: true }];
  try {
    bountySave.write({ ...durable }, id);
    const page = new Bounty(id, Bounty.census(targets));
    const native = new Bounty(`chunk://local/${id}`, Bounty.census(targets), {
      read: slug => { expect(slug).toBe(id); return { ...durable }; },
      write: (value, slug) => { expect(slug).toBe(id); durable = { ...value }; return true; },
    });
    for (const target of [...targets, { kind: 'captain', herd: -1, alive: true }, { kind: 'captain', herd: -1, alive: true }]) {
      expect(native.left(target)).toBe(page.left(target)); expect(native.claim(target)).toBe(page.claim(target));
    }
    expect(durable).toEqual(bountySave.read(id));
    expect(new Bounty(id, Bounty.census(targets), { read: () => durable, write: () => true }).claim(targets[0] ?? { kind: 'crab', herd: 2 })).toBe(false);
  } finally { bountySave.write(original, id); }
});

test('an in-flight pool restores every word and award group silently before an exact suffix', () => {
  installCoinModel(coinGeometry);
  const rng = new RngService(810), afterRng = new RngService(810), at = new Vector3(3, 4, 5), target = new Vector3(1, 2, 3);
  const first = new CoinBurst(new Scene(), () => rng.stream('cosmetic').next());
  const restored = new CoinBurst(new Scene(), () => afterRng.stream('cosmetic').next());
  const paid: number[] = [], resumed: number[] = [];
  let done = 0, resumedDone = 0;
  const original = { onCoin: (n: number) => { paid.push(n); }, onDone: () => { done++; } };
  const continuation = { onCoin: (n: number) => { resumed.push(n); }, onDone: () => { resumedDone++; } };
  try {
    first.spawn(at, 25, original.onCoin, original.onDone);
    first.update(.2, target);
    first.spawn(at, 7, original.onCoin, original.onDone);
    const saved = first.snapshot(), random = rng.snapshot();
    restored.restore(saved, () => continuation); afterRng.restore(random);
    expect(restored.snapshot()).toEqual(saved); expect(resumed).toEqual([]); expect(resumedDone).toBe(0);
    expect(afterRng.snapshot()).toEqual(random);
    for (let i = 0; i < 200; i++) {
      first.update(1 / 60, target); restored.update(1 / 60, target);
      expect(restored.snapshot()).toEqual(first.snapshot());
      expect(resumed).toEqual(paid); expect(resumedDone).toBe(done);
    }
    expect(paid.reduce((sum, n) => sum + n, 0)).toBe(32); expect(done).toBe(2);
    expect(() => restored.restore({ ...saved, groups: [1, 1] }, () => continuation)).toThrow('counts');
    expect(restored.inFlight).toBe(0);
    expect(() => restored.restore(saved, () => { throw new Error('Missing award owner'); })).toThrow('Missing award owner');
    expect(restored.inFlight).toBe(0);
  } finally { first.dispose(); restored.dispose(); }
});

test('purse restore retains unflushed earned coins without a write or listener call', () => {
  let durable = 0; const events: string[] = [];
  const slot = { read: () => durable, write: (n: number) => { durable = n; events.push(`save:${n}`); return true; } };
  const original = new Purse('earned', slot); original.add(3, false);
  const saved = original.snapshot(), restored = new Purse('earned', slot);
  restored.onChange(() => { events.push('changed'); });
  restored.restore(saved); expect(events).toEqual([]); expect(durable).toBe(0);
  expect(restored.snapshot()).toEqual(saved); expect(restored.flush()).toBe(true);
  expect(events).toEqual(['save:3']); expect(durable).toBe(3);
  expect(() => restored.restore({ coins: -1, unsaved: false })).toThrow();
  expect(restored.coins).toBe(3); expect(restored.unsaved).toBe(false);
});

test('the actual native economy and coin preparation import under the unchanged renderer guard', () => {
  const code = "await import('./test/fixtures/driftwood-trade-native.ts'); await import('./test/fixtures/native-hosts/loot/nativeEconomy.ts'); const {prepareNativeCoinRecipe} = await import('./test/fixtures/native-coin-recipe.ts'); const build = await prepareNativeCoinRecipe(); const geometry = build(0xc01); if (geometry.getAttribute('position').count === 0) throw Error('Empty original coin bake'); geometry.dispose();";
  expect(() => execFileSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/sim-node-loader.mjs', '--input-type=module', '-e', code], { timeout: 10_000, stdio: 'pipe' })).not.toThrow();
});
