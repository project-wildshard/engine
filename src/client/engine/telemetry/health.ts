import * as v from 'valibot';
import { actorTags, type ActorTags } from '../../../shared/engine/app/actor';
import type { SaveStore } from '../../../shared/engine/saves/store';
import { classifySession, type Heartbeat, type SessionEnd } from './model';
import { vitalsSchema, type SessionSummary } from './sessionVitals';

const heartbeatSchema = v.object({ session: v.string(), build: v.string(), level: v.string(), stage: v.string(),
  at: v.number(), fps: v.number(), clean: v.boolean(), error: v.boolean(), contextLost: v.boolean(),
  summary: v.exactOptional(vitalsSchema), actor: v.exactOptional(v.picklist(['human', 'agent'])), lane: v.exactOptional(v.string()) });
type TaggedHeartbeat = Heartbeat & Partial<ActorTags>;
export interface HealthReport extends Partial<ActorTags> { kind: 'session'; install: string; heartbeat: Heartbeat; end: SessionEnd; build: string }
export class SessionHealth {
  private readonly local;
  private readonly tab;
  private readonly identity;
  private readonly reported;
  private readonly bootedBuild;
  readonly install: string;
  private current: TaggedHeartbeat;
  private readonly send: (report: HealthReport) => void;
  /** The build that last reached control here ('' when none did), then marks `build` as booted. */
  swapBootedBuild(build: string): string { const previous = this.bootedBuild.read(); this.bootedBuild.write(build); return previous; }
  constructor(store: SaveStore, build: string, send: (report: HealthReport) => void, now: number = Date.now(),
    id: () => string = () => crypto.randomUUID(), actor?: ActorTags) {
    this.send = send;
    // v5 (QA 2026-11-23 row 10): the summary gained optional boot and bootSteps; a v4 heartbeat reads unchanged
    const compatible = { key: 'telemetry.heartbeat', version: 5, schema: v.nullable(heartbeatSchema), initial: () => null, migrate: { 1: (old: unknown) => old, 2: (old: unknown) => old, 3: (old: unknown) => old, 4: (old: unknown) => old } };
    this.local = store.define({ ...compatible, scope: 'device' });
    this.tab = store.define({ ...compatible, scope: 'session' });
    this.identity = store.define({ key: 'telemetry.install', scope: 'device', version: 1, schema: v.string(), initial: () => '' });
    // QA 2026-11-23 row 10: the last build that reached control on this device, so the next boot knows it is an update
    this.bootedBuild = store.define({ key: 'telemetry.bootedBuild', scope: 'device', version: 1, schema: v.string(), initial: () => '' });
    this.reported = store.define({ key: 'telemetry.reported', scope: 'device', version: 1, schema: v.array(v.string()), initial: () => [] });
    this.install = this.identity.read() || id(); this.identity.write(this.install);
    const local = this.local.read(), tab = this.tab.read();
    // A different live tab must not be diagnosed as a killed page. Reloads retain the tab heartbeat.
    const previous = tab ?? (local && (local.clean || now - local.at > 15_000) ? local : null);
    if (previous && !this.reported.read().includes(previous.session)) {
      const { actor: previousActor, lane, ...heartbeat } = previous;
      this.send({ kind: 'session', install: this.install, heartbeat, end: classifySession(previous), build: previous.build,
        ...(previousActor === undefined ? {} : actorTags(lane === undefined ? { actor: previousActor } : { actor: previousActor, lane })) });
      this.reported.write([...this.reported.read(), previous.session].slice(-32));
    }
    this.current = { session: id(), build, level: '', stage: 'boot', at: now, fps: 0, clean: false, error: false, contextLost: false,
      ...(actor === undefined ? {} : actorTags(actor)) };
    this.write();
  }
  private write(): void { this.local.write(this.current); this.tab.write(this.current); }
  beat(level: string, stage: string, fps: number, at: number = Date.now(), summary?: SessionSummary): void {
    this.current = { ...this.current, level, stage, fps, at, clean: false, ...(summary === undefined ? {} : { summary }) }; this.write();
  }
  capture(summary: SessionSummary, level?: string): void {
    this.current.summary = summary;
    if (level !== undefined) this.current.level = level;
    this.write();
  }
  fault(): void { this.current.error = true; this.write(); }
  contextLoss(): void { this.current.contextLost = true; this.write(); }
  exit(summary?: SessionSummary): void {
    this.current.clean = true;
    if (summary !== undefined) this.current.summary = summary;
    this.write();
  }
}
