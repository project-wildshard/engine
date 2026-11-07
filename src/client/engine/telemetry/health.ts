import * as v from 'valibot';
import type { SaveStore } from '../../../shared/engine/saves/store';
import { classifySession, type Heartbeat, type SessionEnd } from './model';

const heartbeatSchema = v.object({ session: v.string(), build: v.string(), level: v.string(), stage: v.string(),
  at: v.number(), fps: v.number(), clean: v.boolean(), error: v.boolean(), contextLost: v.boolean() });
export interface HealthReport { kind: 'session'; install: string; heartbeat: Heartbeat; end: SessionEnd; build: string }
export class SessionHealth {
  private readonly local;
  private readonly tab;
  private readonly identity;
  private readonly reported;
  readonly install: string;
  private current: Heartbeat;
  private readonly send: (report: HealthReport) => void;
  constructor(store: SaveStore, build: string, send: (report: HealthReport) => void, now: number = Date.now(), id: () => string = () => crypto.randomUUID()) {
    this.send = send;
    this.local = store.define({ key: 'telemetry.heartbeat', scope: 'device', version: 1, schema: v.nullable(heartbeatSchema), initial: () => null });
    this.tab = store.define({ key: 'telemetry.heartbeat', scope: 'session', version: 1, schema: v.nullable(heartbeatSchema), initial: () => null });
    this.identity = store.define({ key: 'telemetry.install', scope: 'device', version: 1, schema: v.string(), initial: () => '' });
    this.reported = store.define({ key: 'telemetry.reported', scope: 'device', version: 1, schema: v.array(v.string()), initial: () => [] });
    this.install = this.identity.read() || id(); this.identity.write(this.install);
    const local = this.local.read(), tab = this.tab.read();
    // A different live tab must not be diagnosed as a killed page. Reloads retain the tab heartbeat.
    const previous = tab ?? (local && (local.clean || now - local.at > 15_000) ? local : null);
    if (previous && !this.reported.read().includes(previous.session)) {
      this.send({ kind: 'session', install: this.install, heartbeat: previous, end: classifySession(previous), build: previous.build });
      this.reported.write([...this.reported.read(), previous.session].slice(-32));
    }
    this.current = { session: id(), build, level: '', stage: 'boot', at: now, fps: 0, clean: false, error: false, contextLost: false };
    this.write();
  }
  private write(): void { this.local.write(this.current); this.tab.write(this.current); }
  beat(level: string, stage: string, fps: number, at: number = Date.now()): void {
    this.current = { ...this.current, level, stage, fps, at, clean: false }; this.write();
  }
  fault(): void { this.current.error = true; this.write(); }
  contextLoss(): void { this.current.contextLost = true; this.write(); }
  exit(): void { this.current.clean = true; this.write(); }
}
