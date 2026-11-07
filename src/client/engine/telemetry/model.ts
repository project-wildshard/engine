export type SessionEnd = 'clean' | 'crash' | 'context-loss' | 'likely-oom';
export interface Heartbeat {
  session: string; build: string; level: string; stage: string; at: number; fps: number;
  clean: boolean; error: boolean; contextLost: boolean;
}
export function classifySession(value: Heartbeat): SessionEnd {
  if (value.clean) return 'clean';
  if (value.contextLost) return 'context-loss';
  if (value.error) return 'crash';
  return ['play', 'explore', 'practice', 'playground', 'capture'].includes(value.stage) ? 'likely-oom' : 'clean';
}
export interface AnalyticsMap {
  'death.cause': { level: string; cause: string };
  'quest.step': { level: string; quest: string; step: string };
  'weapon.used': { level: string; weapon: string };
  'level.time': { level: string; seconds: number };
  'boss.attempt': { level: string; boss: string; outcome: 'started' | 'won' | 'died' | 'lost' | 'left' };
  'download.parts': { id: string; level: string; outcome: 'complete' | 'failed' | 'cancelled'; packs: 'on' | 'off'; parts: number; failed: number; fallback: number; fetched: number };
}
export type AnalyticsEvent = { [K in keyof AnalyticsMap]: { name: K; data: AnalyticsMap[K] } }[keyof AnalyticsMap];
export interface AnalyticsBatch { kind: 'analytics'; build: string; install: string; events: AnalyticsEvent[] }
export class AnalyticsSink {
  private queue: AnalyticsEvent[] = [];
  private readonly build: string;
  private readonly install: string;
  private readonly send: (batch: AnalyticsBatch) => void;
  constructor(build: string, install: string, send: (batch: AnalyticsBatch) => void) { this.build = build; this.install = install; this.send = send; }
  record<K extends keyof AnalyticsMap>(name: K, data: AnalyticsMap[K]): void {
    this.queue.push({ name, data } as AnalyticsEvent);
    if (this.queue.length >= 50) this.flush();
  }
  flush(): void {
    if (this.queue.length === 0) return;
    this.send({ kind: 'analytics', build: this.build, install: this.install, events: this.queue.splice(0) });
  }
}
