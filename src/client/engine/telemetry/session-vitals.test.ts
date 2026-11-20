import { expect, test } from 'vitest';
import { SaveStore, type SaveStorage } from '../../../shared/engine/saves/store';
import { SessionHealth, type HealthReport } from './health';
import { SessionVitals, sessionDevice } from './sessionVitals';

function storage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

test('the original boot and FPS buckets survive a reload in the one existing session summary', () => {
  const local = storage(), session = storage(), save = (): SaveStore => new SaveStore({ local, session });
  const reports: HealthReport[] = [], send = (report: HealthReport): void => { reports.push(report); };
  const health = new SessionHealth(save(), 'same-build', send, 100, () => 'first-session', { actor: 'agent', lane: 'fixture' });
  const vitals = new SessionVitals(sessionDevice('Mozilla iPad', 'iPad', 1));
  vitals.begin(10, 'phone'); vitals.frame(110); vitals.joined(260);
  vitals.begin(280, 'desktop'); vitals.frame(310); vitals.joined(350);
  for (const fps of [19, 20, 29, 30, 44, 45, 59, 60]) vitals.sample(fps);
  health.beat('nine-dragon-stack', 'play', 45, 400, vitals.reading());
  health.exit(vitals.reading());
  expect(reports).toHaveLength(0);
  new SessionHealth(save(), 'same-build', send, 500, () => 'second-session');
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    kind: 'session', end: 'clean', actor: 'agent', lane: 'fixture',
    heartbeat: { level: 'nine-dragon-stack', fps: 45,
      summary: { device: 'tablet', tier: 'phone', firstFrameMs: 100, joinedMs: 250, fpsHistogram: [1, 2, 2, 2, 1] } },
  });
});
