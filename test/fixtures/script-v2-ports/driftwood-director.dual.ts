import source from '../../../src/shards/driftwood-isle/behaviour/directorV2.as?raw';
import original from '../../../src/shards/driftwood-isle/behaviour/director.as?raw';
import declaration from '../../../src/shards/driftwood-isle/data/director.json' with { type: 'json' };
import {driftwoodDirector as embedded} from '../director-modules';
import { expect } from 'vitest';
import { directorPort } from '../script-v2-director';

export const port = directorPort({ source,original,declaration,embedded,header: 'driftwoodDirector',
  states: [{ name: 'initialized',type: 'bool',initial: 0 },{ name: 'altar',type: 'bool',initial: 0 },{ name: 'dead',type: 'bool',initial: 0 },{ name: 'reward',type: 'f64',initial: -1 }],
  parameters: ['radius','delay'],verify: create => {
    const observe = { altar: 0,dead: 0,seen: 0,'player-x': 30,'player-z': 30,'reward-x': 0,'reward-z': 0 };
    const restored = create();
    expect(restored.run({ ...observe,altar: 1 },{ dt: 1,roundtrip: true }).events.map(row => row.key)).toEqual(['captain.restore']);
    expect(restored.run({ ...observe,altar: 1 },{ dispatch: true }).events).toEqual([]);
    const session = create();expect(session.run(observe,{ dt: 0 }).events).toEqual([]);
    expect(session.run({ ...observe,altar: 1 },{ dispatch: true }).events.map(row => row.key)).toEqual(['captain.wake']);
    const dead = { ...observe,altar: 1,dead: 1,'player-x': 0,'player-z': 0 };
    const killed = session.run(dead,{ dispatch: true,roundtrip: true });expect(killed.events.map(row => row.key)).toEqual(['captain.dead']);expect(killed.state['reward']).toBe(-1);
    const start = session.run(dead,{ dt: 1,roundtrip: true });expect(start.events.map(row => row.key)).toEqual(['reward.start']);expect(start.state['reward']).toBe(1);
    for (let i = 0; i < 6; i++) expect(session.run(dead,{ dt: 1,roundtrip: true }).events).toEqual([]);
    const finish = session.run(dead,{ dt: 0.01,roundtrip: true });expect(finish.events.map(row => row.key)).toEqual(['reward.finish']);expect(finish.state['reward']).toBe(-2);
    expect(session.run(dead,{ dt: 1 }).events).toEqual([]);
    // Strict distance boundary, seen flag, and already-dead boot do not start
    // a reward until a subsequent positive elapsed call actually qualifies.
    for (const seen of [0,1]) {
      const boundary = create();boundary.run({ ...dead,seen },{ dt: 1 });
      expect(boundary.run({ ...dead,seen,'player-x': 7 },{ dt: 1 }).events).toEqual([]);
      expect(boundary.run({ ...dead,seen },{ dt: 0 }).events).toEqual([]);
      const nearby = boundary.run({ ...dead,seen },{ dt: 0.1,roundtrip: true });expect(nearby.events.map(row => row.key)).toEqual(seen ? [] : ['reward.start']);
    }
    const long = create();long.run(observe,{ dt: 0 });
    const emitted: string[] = [];
    for (let i = 0; i < 1200; i++) {
      const next = long.run({ ...observe,altar: Number(i>=10),dead: Number(i>=20),'player-x': i < 60 ? 30 : 0,'player-z': 0 },{ dt: i%7 === 0 ? 0 : 1/60,roundtrip: i%29 === 0 });
      emitted.push(...next.events.map(row => row.key));
    }
    expect(emitted).toEqual(['captain.wake','captain.dead','reward.start','reward.finish']);
  },
});
