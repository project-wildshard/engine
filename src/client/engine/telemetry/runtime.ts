import { harnessPins } from '../../../shared/engine/app/identity';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { actorTags } from '../../../shared/engine/app/actor';
import type { App } from '../app/app';
import { apiUrl } from '../core/apiOrigin';
import { Scope } from '../../../shared/engine/app/scope';
import { saves } from '../../../shared/engine/saves/runtime';
import { SessionHealth } from './health';
import { AnalyticsSink, type FailureClear } from './model';
import { flushCrossroads } from './crossroads';
import { FailureOutbox, failureOutcomeSave } from './failureEpisodes';
import { FailureTelemetry } from './failureTelemetry';
import { pageActor } from './pageActor';
import { SessionVitals, sessionDevice, type BootStep, type SessionSummary } from './sessionVitals';
import { bootKind, bootStepTimes } from './bootSteps';
import { bootTiming } from '../../../shared/engine/boot/timing';
import * as v from 'valibot';

declare const __BUILD_ID__: string;
let vitals: SessionVitals | undefined;
let health: SessionHealth | null = null;
let level = '';
/** The primary load card adopts the navigation clock. Inset cell loads do not start a page boot. */
export function noteWorldBoot(started: number, tier: NonNullable<SessionSummary['tier']>, zone: string): void {
  if (vitals?.begin(started, tier, zone) === true) {
    level = zone;
    health?.capture(vitals.reading(), zone);
  }
}
export function noteWorldStep(step?: BootStep): void {
  if (vitals?.step(step) === true) health?.capture(vitals.reading());
}
export function noteWorldFrame(): void { vitals?.frame(diagnosticNow()); }
/** QA 2026-11-23 row 10: the last build that reached control on this device, so the next boot knows it is an update. */
const bootedBuild = saves.define({ key: 'telemetry.bootedBuild', scope: 'device', version: 1, schema: v.string(), initial: () => '' });
function noteBootSteps(): void {
  const build = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
  if (vitals === undefined || build === '') return;
  vitals.booted(bootKind(bootedBuild.read(), build), bootStepTimes(bootTiming()));
  bootedBuild.write(build);
}
function noteWorldJoined(): void {
  if (vitals === undefined) return;
  vitals.joined(diagnosticNow());
  noteBootSteps();
  health?.capture(vitals.reading());
}
let analytics: AnalyticsSink | null = null;
let bound: App | null = null;
let scope: Scope | null = null;
let failures: FailureTelemetry | null = null;
/** Presentation observation is inert until the page composition root explicitly starts telemetry. */
export function showFailure(owner: Scope, root: HTMLElement, ids: string): void { failures?.show(owner, root, ids); }
export function clearFailure(root: HTMLElement, cause: FailureClear, owner?: Scope): void { failures?.clear(root, cause, owner); }
const send = (body: object): void => {
  // Capture/parity previews do not host API functions; their observations must stay deterministic.
  if (typeof window === 'undefined' || harnessPins() !== undefined) return;
  void fetch(apiUrl('telemetry'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
};
/** E7.8a shares the existing anonymous install and telemetry endpoint. */
const sendFromPage = (body: object): void => { send({ ...body, ...actorTags(pageActor()) }); };
export function onlineTelemetry():{install:string;send:(body:object)=>void}{startTelemetry();return {install:health?.install??crypto.randomUUID(),send:sendFromPage};}
/** Start the page telemetry session and its native event observers once. */
export function startTelemetry(): void {
  if (health !== null || typeof window === 'undefined' || typeof document === 'undefined') return;
  const build = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
  const actor = actorTags(pageActor());
  health = new SessionHealth(saves, build, send, undefined, undefined, actor);
  vitals = new SessionVitals(sessionDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
  scope = new Scope('telemetry');
  scope.listen(document, 'ws:control-ready', noteWorldJoined);
  analytics = new AnalyticsSink(build, health.install, sendFromPage);
  if (harnessPins() === undefined) {
    const slot = saves.define(failureOutcomeSave);
    const outbox = new FailureOutbox({ getItem: () => slot.read(),
      setItem: (_key, value) => { if (!slot.write(value)) throw new Error('Failure outcome storage refused'); },
      removeItem: () => { if (!slot.write(null)) throw new Error('Failure outcome acknowledgement storage refused'); } }, actor);
    failures = new FailureTelemetry(scope, outbox, build, health.install, () => level || 'boot', async batch => {
      const response = await fetch(apiUrl('telemetry'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch), keepalive: true });
      return response.ok;
    });
    void flushCrossroads();
    scope.listen(window, 'online', () => { void flushCrossroads(); });
  }
  const fps: number[] = [];
  scope.interval(1000, () => {
    const value = bound?.render?.stats.fps;
    if (value === undefined || value <= 0 || !Number.isFinite(value)) return;
    fps.push(value); if (fps.length > 5) fps.shift();
    if (bound?.state === 'play' && !document.hidden) vitals?.sample(value);
  });
  scope.interval(5000, () => { const sorted = [...fps].sort((a, b) => a - b); health?.beat(level, bound?.state ?? 'boot', sorted[Math.floor(sorted.length / 2)] ?? 0, Date.now(), vitals?.reading()); });
  scope.interval(30_000, () => { analytics?.flush(); });
  scope.listen(window, 'error', () => { health?.fault(); });
  scope.listen(window, 'unhandledrejection', () => { health?.fault(); });
  scope.listen(document, 'webglcontextlost', () => { health?.contextLoss(); }, { capture: true });
  scope.listen(window, 'pagehide', () => { health?.exit(vitals?.reading()); recordTime(); analytics?.flush(); });
  scope.listen(window, 'pageshow', () => { health?.beat(level, bound?.state ?? 'boot', 0); });
  if (bound) subscribe(bound);
}
let startedAt = 0;
function recordTime(): void {
  if (level !== '' && bound) analytics?.record('level.time', { level, seconds: Math.max(0, bound.clock.real - startedAt) });
  startedAt = bound?.clock.real ?? 0;
}
function subscribe(app: App): void {
  if (scope === null) return;
  app.events.on('level.loaded', ({ id }) => { recordTime(); level = id; startedAt = app.clock.real; }, scope);
  app.events.on('level.unloaded', () => { recordTime(); level = ''; }, scope);
  app.events.on('fault', () => { health?.fault(); }, scope);
  app.events.on('player.died', ({ cause }) => { analytics?.record('death.cause', { level, cause: cause?.kind ?? 'unknown' }); }, scope);
  app.events.on('weapon.fired', ({ id }) => { analytics?.record('weapon.used', { level, weapon: id }); }, scope);
  app.events.on('quest.step', ({ level: questLevel, quest, step }) => { analytics?.record('quest.step', { level: questLevel, quest, step: step ?? 'completed' }); }, scope);
  app.events.on('boss.attempt', ({ boss, outcome, level: where }) => { analytics?.record('boss.attempt', { level: where ?? level, boss, outcome }); }, scope);
  app.events.on('download.parts', (event) => { analytics?.record('download.parts', { id: event.id, level: event.level, outcome: event.outcome, packs: event.packs ? 'on' : 'off', parts: event.parts, failed: event.failed, fallback: event.fallbackFiles, fetched: event.fetched }); }, scope);
}
/** Bind telemetry counters to the current application. */
export function bindTelemetry(app: App): void { if (bound === app) return; bound = app; if (health) subscribe(app); }
