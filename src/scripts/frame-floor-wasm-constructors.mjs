// sp-x6's corrected native constructor observer. No watcher, timer or rAF;
// stack collection and scalar snapshots happen after the native timed segment.
export function observeConstructors() {
  const rows = [], memories = new WeakMap(), modules = new WeakMap();
  let sequence = 0, memoryId = 0, moduleId = 0;
  const state = { rows, origin: performance.timeOrigin, installedAt: performance.now(), dropped: 0 };
  window.__wasmDurationCensus = state;
  const game = () => window.__wildshard?.world?.game;
  for (const kind of ['Memory', 'Module', 'Instance']) {
    const Native = WebAssembly[kind];
    WebAssembly[kind] = new Proxy(Native, { construct(target, args, newTarget) {
      const beforeFrame = game()?.frameCount ?? null, previousRafMs = game()?.frameRafTime ?? null, startMs = performance.now();
      let result, error;
      try { result = Reflect.construct(target, args, newTarget); return result; }
      catch (caught) { error = caught; throw caught; }
      finally {
        const endMs = performance.now();
        if (rows.length >= 1024) state.dropped++;
        else {
          const row = { sequence: ++sequence, kind, startMs, endMs, durationMs: endMs - startMs, beforeFrame, previousRafMs,
            afterFrame: game()?.frameCount ?? null, route: window.__frameFloorGridStop ?? null,
            success: error === undefined, error: error === undefined ? null : error instanceof Error ? error.message : 'Native constructor threw', stack: new Error('Native constructor site').stack };
          if (kind === 'Memory') { row.descriptor = { ...args[0] }; if (result) { row.memory = ++memoryId; memories.set(result, row.memory); } }
          if (kind === 'Module' && result) { row.module = ++moduleId; modules.set(result, row.module); row.byteLength = args[0].byteLength; }
          if (kind === 'Instance') { row.module = modules.get(args[0]) ?? null; row.memory = memories.get(args[1]?.env?.memory) ?? null; }
          rows.push(row);
        }
      }
    } });
  }
}

/** Page initializer, injected before application modules only when requested. */
export const WASM_CONSTRUCTORS_SCRIPT = `(${observeConstructors.toString()})();`;

/** Detached pool counters at existing drive checkpoints; older app pins report null. */
export const SCRIPT_MEMORY_POOL = 'window.__wildshard?.scriptMemory?.() ?? null';
