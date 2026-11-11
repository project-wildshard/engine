import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { nalati, row, body, lead, stand, storm, words } from './fixtures/windEliteRoom';

// TEST-SPEED TS5 (J255): wind-elite-room was 26-31 s hosted. Split from wind-elite-room.test.ts by case; bodies unchanged.
test('in a room he deals with whoever is nearest, and his fight outlives their leaving', { timeout: 120_000 }, async () => {
  const live = await nalati(), { host } = live;
  try {
    stand(host, 180, 40); storm(host);
    for (let i = 0; i < 2400 && body(host) === null; i++) host.step();
    const eagle = body(host); if (eagle === null) throw new Error('No storm brought him');
    const far = lead(host), near = host.addPlayer('bot:2', { x: eagle.position.x + 6, y: host.groundHeightAt(eagle.position.x + 6, eagle.position.z) + .1, z: eagle.position.z });
    const hold = (player: typeof near, x: number, z: number): void => { const at = new Vector3(x, host.groundHeightAt(x, z) + .1, z); player.position.copy(at); player.motor.resetAt(at); };
    const hp = near.health.attributes.health, farHp = far.health.attributes.health;
    for (let i = 0; i < 2400 && near.health.attributes.health === hp; i++) { host.step(); words(host); hold(near, eagle.position.x + 6, eagle.position.z); hold(far, 180 + 60, 40); if (eagle.position.y - host.groundHeightAt(eagle.position.x, eagle.position.z) < 20) break; }
    const spot = near.position.clone();
    for (let i = 0; i < 600 && near.health.attributes.health === hp; i++) { host.step(); words(host); hold(near, spot.x, spot.z); hold(far, spot.x + 60, spot.z); }
    expect(near.health.attributes.health).toBe(hp - 30); expect(far.health.attributes.health).toBe(farHp);
    host.removePlayer(near.id);
    for (let i = 0; i < 120; i++) host.step();
    expect(row(host).state).toBe('engaged');
  } finally { live.dispose(); }
});
