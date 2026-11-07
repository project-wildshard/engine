import source from '../../../src/shards/pine-hollow/behaviour/directorV2.as?raw';
import original from '../../../src/shards/pine-hollow/behaviour/director.as?raw';
import declaration from '../../../src/shards/pine-hollow/data/director.json' with { type: 'json' };
import {pineDirector as embedded} from '../director-modules';
import { expect } from 'vitest';
import { directorPort } from '../script-v2-director';

export const port = directorPort({ source,original,declaration,embedded,header: 'pineDirector',
  states: [{ name: 'dawn',type: 'f64',initial: -1 }],
  parameters: ['sunriseAt','lanternsAt','captionAt','finishAt','nightValue','sunriseValue'],
  verify: create => {
    for (const hasClock of [0,1]) {
      const session = create(), observation = { 'night-request': 0,'dawn-request': 0,seen: 0,'has-clock': hasClock,night: 0 };
      const first = session.run(observation,{ dt: 1,events: ['night.request','dawn.request'],roundtrip: true });
      expect(first.state['dawn']).toBe(0);expect(first.events.map(row => row.key)).toEqual(hasClock ? ['night.consume','night.start','dawn.start'] : ['night.consume','dawn.start']);
      expect(session.run(observation,{ dispatch: true,events: ['dawn.request'] }).events).toEqual([]);
      const history: string[] = [];
      for (const dt of [0.1,0.9,1,0.49,0.01,0.5,1,1,0.1,0.9,1,1,1,1,1,1]) {
        const next = session.run(observation,{ dt,roundtrip: true });history.push(...next.events.map(row => row.key));
      }
      expect(history).toEqual(hasClock ? ['dawn.sunrise','dawn.lanterns','dawn.caption','dawn.finish'] : ['dawn.lanterns','dawn.caption','dawn.finish']);
      expect(session.run({ ...observation,seen: 1 },{ events: ['dawn.request'] }).state['dawn']).toBe(-1);
      expect(session.run({ ...observation,night: 0.5 },{ events: ['night.request'] }).events.map(row => row.key)).toEqual(['night.consume']);
      expect(session.run({ ...observation,night: 1,'night-request': 1 }).events.map(row => row.key)).toEqual(['night.consume']);
    }
    const session = create(), observation = { 'night-request': 0,'dawn-request': 1,seen: 0,'has-clock': 1,night: 0 };
    session.run(observation,{ dt: 0 });
    for (let i = 0; i < 800; i++) {
      const answer = session.run({ ...observation,'dawn-request': 0,'night-request': Number(i%89 === 0) },{ dt: i%7 === 0 ? 0 : 1/60,roundtrip: i%31 === 0 });
      if (i < 100) expect(answer.state['dawn']).toBeGreaterThanOrEqual(0);
    }
  },
});
