export function accuracyRecorder() {
      /** @type {import('./accuracy-data.d.mts').AdmissionFrames} */
      const admissionFrames = {protocol: 'loading-admission-raf/1', frames: 0, droppedFrames: 0,
        truncatedFrames: 0, maxGapMs: 0, endedAt: null, runs: []};
      const state = { version: 2, samples: [], final: null, readyAt: 0, firstAt: -1, last: '', lastSampleAt: 0, updates: [], errors: [], resources: [], workerReceipts: [], admissionFrames };
      Reflect.set(window, '__loadingAccuracy', state);
      // One cheap DOM tuple per animation callback, not a full row/resource
      // snapshot. These are observed callback facts, not inferred step starts
      // or proof that a browser painted between callbacks. Overflow is explicit.
      /** @type {number | null} */
      let lastAdmissionAt = null;
      /** @param {number} at */
      const frame = at => {
        if (state.readyAt) return;
        const root = document.querySelector('.ws-load');
        const step = root instanceof HTMLElement ? root.dataset.step ?? '' : '';
        if (root instanceof HTMLElement && !Object.hasOwn(root.dataset, 'shell') && !root.classList.contains('hide')
          && (step === 'admission' || step.startsWith('admission.') && step !== 'admission.modules')) {
          const raw = {step, footer: root.querySelector('[data-el="foot"]')?.textContent ?? '',
            waiting: root.dataset.waiting ?? '', filesInFlight: root.dataset.filesInFlight ?? ''};
          if (Object.values(raw).some(value => value.length > 1024)) admissionFrames.truncatedFrames++;
          const facts = {step: step.slice(0, 1024), footer: raw.footer.slice(0, 1024),
            waiting: raw.waiting.slice(0, 1024), filesInFlight: raw.filesInFlight.slice(0, 1024)};
          admissionFrames.frames++;
          if (lastAdmissionAt !== null) admissionFrames.maxGapMs = Math.max(admissionFrames.maxGapMs, at - lastAdmissionAt);
          const previous = admissionFrames.runs.at(-1);
          if (previous !== undefined && previous.lastAt === lastAdmissionAt && previous.step === facts.step && previous.footer === facts.footer
            && previous.waiting === facts.waiting && previous.filesInFlight === facts.filesInFlight) {
            previous.lastAt = at; previous.frames++;
          } else if (admissionFrames.runs.length < 256) admissionFrames.runs.push({firstAt: at, lastAt: at,
            frames: 1, ...facts});
          else admissionFrames.droppedFrames++;
          lastAdmissionAt = at; admissionFrames.endedAt = null;
        } else if (lastAdmissionAt !== null) { admissionFrames.endedAt = at; lastAdmissionAt = null; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      navigator.serviceWorker.addEventListener('message', event => {
        if (!state.readyAt && ['WS_BACKGROUND_DOWNLOAD', 'WS_WORKER_DOWNLOAD'].includes(event.data?.type)) state.workerReceipts.push(event.data);
      });
      new PerformanceObserver(list => {
        if (!state.readyAt) for (const entry of list.getEntries()) state.resources.push(entry.toJSON());
      }).observe({ type: 'resource', buffered: true });
      window.addEventListener('error', event => { if (state.errors.length < 100) state.errors.push(event.message); });
      window.addEventListener('unhandledrejection', event => { if (state.errors.length < 100) state.errors.push(String(event.reason)); });
      const read = () => {
        const root = document.querySelector('.ws-load');
        if (!(root instanceof HTMLElement) || Object.hasOwn(root.dataset, 'shell') || state.readyAt) return;
        const now = performance.now();
        if (state.firstAt < 0) state.firstAt = now;
        const text = key => root.querySelector(`[data-el="${key}"]`)?.textContent ?? '';
        const rows = [...root.querySelectorAll('[data-el="rows"] > div')].map(row => ({
          label: row.children.item(0)?.textContent ?? '', detail: row.children.item(1)?.textContent ?? '',
          duration: row.children.item(2)?.textContent ?? '', state: row.className,
          key: row.dataset.key, ms: row.dataset.ms, startedAt: row.dataset.startedAt, setupAtStart: row.dataset.setupAtStart,
        }));
        const startedAt = root.dataset.startedAt, started = Number(startedAt);
        const elapsedMs = startedAt !== undefined && startedAt !== '' && Number.isFinite(started) && started >= 0 && started <= now ? now - started : null;
        const sample = { at: now, elapsedMs, clock: text('clock'), tier: text('tier'), fading: root.classList.contains('hide'), detail: text('suFact'), download: text('dlFact'), footer: text('foot'), diagnostics: text('diagnostics'),
          waiting: root.dataset.waiting, filesInFlight: root.dataset.filesInFlight, stalled: root.dataset.stalled,
          path: root.dataset.path, step: root.dataset.step, setup: root.dataset.setup,
          networkBytes: root.dataset.networkBytes, cachedBytes: root.dataset.cachedBytes,
          declaredBytes: root.dataset.declaredBytes, downloadPercent: root.dataset.download,
          pendingBytes: root.dataset.pendingBytes, unclassifiedFiles: root.dataset.unclassifiedFiles, prefetch: root.dataset.prefetch, rows };
        // Wait ages are clocks, not completed work. Real transport/cache byte
        // changes still count during a long read before its file completes.
        const footer = sample.footer.replaceAll(/ · \d+(?:\.\d+)? s(?= ·|$)/gu, '');
        const detailed = `${sample.detail}|${sample.setup}|${sample.fading}|${footer}|${sample.networkBytes}|${sample.cachedBytes}|${sample.pendingBytes}|${sample.unclassifiedFiles}|${sample.prefetch}|${rows.map(row => row.detail).join('|')}`;
        const changed = detailed !== state.last;
        if (changed) { state.updates.push(now); state.last = detailed; }
        if (changed || now - state.lastSampleAt >= 250) { state.samples.push(sample); state.lastSampleAt = now; }
        state.final = sample;
        if (root.classList.contains('hide')) {
          state.readyAt = now;
          if (admissionFrames.frames > 0 && admissionFrames.endedAt === null) admissionFrames.endedAt = now;
        }
      };
      setInterval(read, 250);
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(read).observe(document.documentElement, {
          attributes: true, subtree: true, childList: true, characterData: true, attributeFilter: ['class'],
        });
      });
    }

/** Proof-only caption: captured pixels identify the served SHA and actual path. */
export function accuracyCaption(text) {
  const label = document.createElement('div');
  label.textContent = text;
  label.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:3px 5px;background:#07121fed;color:white;font:10px/16px monospace;text-align:center;pointer-events:none';
  document.body.append(label);
}
