import { harnessPins } from '../../../shared/engine/app/identity';
import type { App } from '../app/app';
import { apiUrl } from '../core/apiOrigin';
import { Scope } from '../../../shared/engine/app/scope';
import { saves } from '../../../shared/engine/saves/runtime';
import { SessionHealth } from './health';
import { AnalyticsSink } from './model';
import { flushCrossroads } from './crossroads';

declare const __BUILD_ID__: string;
let health: SessionHealth | null = null;
let analytics: AnalyticsSink | null = null;
let bound: App | null = null;
let scope: Scope | null = null;
let level = '';
const send = (body: object): void => {
  // Capture/parity previews do not host API functions; their observations must stay deterministic.
  if (typeof window === 'undefined' || harnessPins() !== undefined) return;
  void fetch(apiUrl('telemetry'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
};
/** Start the page telemetry session and its native event observers once. */
export function startTelemetry(): void {
  if (health !== null || typeof window === 'undefined' || typeof document === 'undefined') return;
  const build = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
  health = new SessionHealth(saves, build, send);
  analytics = new AnalyticsSink(build, health.install, send);
  scope = new Scope('telemetry');
  if (harnessPins() === undefined) {
    void flushCrossroads();
    scope.listen(window, 'online', () => { void flushCrossroads(); });
  }
  const fps: number[] = [];
  scope.interval(1000, () => { const value = bound?.render?.stats.fps; if (value !== undefined && value > 0) { fps.push(value); if (fps.length > 5) fps.shift(); } });
  scope.interval(5000, () => { const sorted = [...fps].sort((a, b) => a - b); health?.beat(level, bound?.state ?? 'boot', sorted[Math.floor(sorted.length / 2)] ?? 0); });
  scope.interval(30_000, () => { analytics?.flush(); });
  scope.listen(window, 'error', () => { health?.fault(); });
  scope.listen(window, 'unhandledrejection', () => { health?.fault(); });
  scope.listen(document, 'webglcontextlost', () => { health?.contextLoss(); }, { capture: true });
  scope.listen(window, 'pagehide', () => { health?.exit(); recordTime(); analytics?.flush(); });
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
  app.events.on('boss.attempt', (event) => { analytics?.record('boss.attempt', { level, ...event }); }, scope);
  app.events.on('download.parts', (event) => { analytics?.record('download.parts', { id: event.id, level: event.level, outcome: event.outcome, packs: event.packs ? 'on' : 'off', parts: event.parts, failed: event.failed, fallback: event.fallbackFiles, fetched: event.fetched }); }, scope);
}
/** Bind telemetry counters to the current application. */
export function bindTelemetry(app: App): void { if (bound === app) return; bound = app; if (health) subscribe(app); }
