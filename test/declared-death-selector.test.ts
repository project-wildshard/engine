// oxlint-disable-next-line import/no-nodejs-modules -- Runs the real native creature and shipped physics.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { DeclaredQuests } from '../src/shared/game/quest/declared';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));

test('death triggers select the exact spawn id as well as creature tags, with per-player conditions', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier });
  try {
    const body = [...host.entities.values()][0]; if (body === undefined) throw new Error('No fixture body');
    const tags = [body.entityId, ...body.combatActor().tags, 'different-spawn'];
    new DeclaredQuests(host, { flags: ['accepted', ...tags.map((_, i) => `kill.${i}`)], quests: [], dialogue: [],
      triggers: tags.map((tag, i) => ({ id: `trigger.${i}`, kind: 'death', tag, flag: `kill.${i}`, when: { all: ['accepted'] } })) });
    host.addPlayer('ready', { x: 0, y: 0, z: 0 }); host.addPlayer('waiting', { x: 0, y: 0, z: 0 });
    const ready = questBooks(host).of('ready').flags, waiting = questBooks(host).of('waiting').flags;
    ready.set('accepted');
    host.combat.hit({ source: 'env', sourceTags: ['actor.player'], target: body.combatActor(), amount: 1000,
      point: body.position.clone(), dir: new Vector3(0, 0, 1) });
    host.step();
    expect(body.alive).toBe(false);
    expect(ready.has('kill.0')).toBe(true); // the authored spawn id (Honeyknoll F43)
    for (let i = 0; i < tags.length; i++) {
      expect(ready.has(`kill.${i}`)).toBe(i < tags.length - 1);
      expect(host.flags.has(`kill.${i}`)).toBe(false);
      expect(waiting.has(`kill.${i}`)).toBe(false);
    }
  } finally { host.dispose(); }
});
