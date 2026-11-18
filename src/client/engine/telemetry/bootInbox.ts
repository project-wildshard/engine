/** Renderer-free transport. bootTrace owns the durable queue until the server acknowledges it. */
import { apiUrl } from '../core/apiOrigin';
import type { SendResult } from '../core/errorReport';
import type { BootRecord, BootTraceTransports, PendingReport } from '../boot/bootTrace';

const ERRORS_URL = apiUrl('errors');

export async function reportBootInterruption(error: Error, build: string, diagnostic: string, system = 'boot-abrupt', levelId = ''): Promise<SendResult> {
  try {
    const response = await fetch(ERRORS_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ system, message: error.message.slice(0, 500), stack: '', count: 1,
        fatal: false, disabled: false, sinceBootMs: 0,
        context: { build, shard: levelId, bootDiagnostic: diagnostic } }),
    });
    if (response.ok) return 'ok';
    return response.status === 429 || response.status >= 500 ? 'retry' : 'reject';
  } catch { return 'retry'; }
}

/** What a flush reads and writes: bootTrace's durable report queue and its transports. */
export interface FlushPorts {
  reports: () => PendingReport[];
  saveReports: (queue: PendingReport[]) => boolean;
  reportLine: (prior: BootRecord, reason: string) => string;
  transports: BootTraceTransports;
}

/** Send each queued interrupted-boot report to the inbox and to Sentry, keeping it until both acknowledge. It lives in this
 *  chunk, beside the inbox send: a page with nothing queued never loads either (the session closure's raw budget). */
export async function flushPending({ reports, saveReports, reportLine, transports }: FlushPorts): Promise<void> {
  for (const pending of reports()) {
    const prior = pending.record;
    const system = pending.reason ? 'gpu-recovery' : 'boot-abrupt';
    const diagnostic = { previousBuild: prior.build, attempt: prior.id, stage: prior.stage, detail: prior.detail ?? '',
      elapsedMs: prior.updatedAt - prior.startedAt, visibility: prior.visibility, checkpoints: prior.checkpoints ?? [] };
    const message = `${reportLine(prior, pending.reason)}; previous build ${prior.build}; visibility ${prior.visibility}`;
    const acknowledge = (channel: 'inbox' | 'sentry'): void => {
      const queue = reports();
      const entry = queue.find((p) => p.record.id === prior.id);
      if (entry) entry[channel] = true;
      saveReports(queue.filter((p) => !p.inbox || !p.sentry));
    };
    await Promise.all([
      pending.inbox ? Promise.resolve() : Promise.resolve().then(async () => {
        const result = await transports.inbox(new Error(message), prior.build,
          JSON.stringify({ ...diagnostic, checkpoints: diagnostic.checkpoints.slice(-8) }), system, prior.levelId);
        if (result === 'ok' || result === 'reject') acknowledge('inbox');
        return undefined;
      }).catch(() => { /* leave durable evidence for the next online event or document */ }),
      pending.sentry ? Promise.resolve() : transports.deliver(new Error(message), {
        system, build: prior.build, shard: prior.levelId, bootStage: prior.stage, fatal: false, diagnostic,
      }).then((ok) => { if (ok) acknowledge('sentry'); return undefined; }).catch(() => { /* independently retry Sentry */ }),
    ]);
  }
}
