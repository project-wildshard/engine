import { expect, test } from 'vitest';
import { serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { ADAPTER, nalati, row, body, lead, stand, storm, words } from './fixtures/windEliteRoom';

// TEST-SPEED TS5 (J255): wind-elite-room was 26-31 s hosted. Some cases moved to wind-elite-room-fight.test.ts; the helpers are in test/fixtures/windEliteRoom.ts.
test('he rides the wind over his rock, stoops, grounds, falls and stays fallen through a save', { timeout: 120_000 }, async () => {
  const live = await nalati(), { host } = live, heard = new Set<string>();
  try {
    expect(host.adapters.has(ADAPTER)).toBe(true);
    expect(row(host).state).toBe('absent');
    stand(host, 180, 40); storm(host);
    let i = 0; for (; i < 2400 && body(host) === null; i++) host.step();
    const eagle = body(host); if (eagle === null) throw new Error('No storm brought him');
    expect(eagle.variant).toBe('qyran'); expect(eagle.motor ?? null).toBeNull();
    for (i = 0; i < 300; i++) { host.step(); for (const name of words(host)) heard.add(name); }
    expect(eagle.position.y - host.groundHeightAt(eagle.position.x, eagle.position.z)).toBeGreaterThan(10);
    for (i = 0; i < 1800 && !heard.has('elite.wind:qyran'); i++) { host.step(); for (const name of words(host)) heard.add(name); stand(host, eagle.position.x + 30, eagle.position.z); }
    expect(heard).toContain('elite.wind:qyran');
    expect(row(host).state).toBe('engaged');
    let low = Infinity;
    for (i = 0; i < 900 && !heard.has('elite.moment:qyran.grounded'); i++) { host.step(); for (const name of words(host)) heard.add(name); low = Math.min(low, eagle.position.y - host.groundHeightAt(eagle.position.x, eagle.position.z)); if (i % 40 === 0) stand(host, eagle.position.x + 30, eagle.position.z); }
    expect(heard).toContain('elite.moment:qyran.cry'); expect(heard).toContain('elite.moment:qyran.grounded');
    expect(low).toBeLessThan(5);
    const held = serializeSimSnapshot(snapshotSimHostBytes(host));
    const back = await nalati(held);
    try {
      const again = body(back.host); expect(again?.entityId).toBe(eagle.entityId); expect(again?.position.y).toBeCloseTo(eagle.position.y, 3);
      for (i = 0; i < 30; i++) back.host.step();
      expect(row(back.host).state).toBe('engaged');
    } finally { back.dispose(); }
    // a player who stays put takes the stoop, and it throws them
    stand(host, eagle.position.x + 6, eagle.position.z); heard.clear();
    const hp = lead(host).health.attributes.health;
    for (i = 0; i < 1500 && lead(host).health.attributes.health === hp; i++) { host.step(); words(host); const { position } = lead(host); stand(host, position.x, position.z); }
    expect(lead(host).health.attributes.health).toBe(hp - 30);
    eagle.hp = 0; eagle.alive = false;
    for (i = 0; i < 30; i++) host.step();
    expect(row(host).state).toBe('dead');
    expect(eagle.position.y - host.groundHeightAt(eagle.position.x, eagle.position.z)).toBeLessThan(1);
    const orb = row(host).reward; if (orb === null || orb === undefined) throw new Error('He left no orb');
    expect(orb.y - host.groundHeightAt(orb.x, orb.z)).toBeLessThan(2); // not left in the sky he fell from
    stand(host, orb.x + .4, orb.z + .4); host.step(); actRoutes(host).claims.get('qyran.reward')?.(lead(host).id);
    expect(row(host).reward).toBeNull();
    const fallen = serializeSimSnapshot(snapshotSimHostBytes(host));
    const third = await nalati(fallen);
    try { expect(row(third.host).state).toBe('dead'); expect(row(third.host).sleep).toBeGreaterThan(0); for (i = 0; i < 30; i++) third.host.step(); expect(row(third.host).state).toBe('dead'); } finally { third.dispose(); }
  } finally { live.dispose(); }
});
