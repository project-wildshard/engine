import type {Capture, ControlWitness, Mark, PanelRow, Row} from './model.ts';
/** Executed before app scripts on every document, including tap-triggered navigation. */
export function instrument(flow: string): void {
  const epoch = (): number => performance.timeOrigin + performance.now();
  const key = 'phone-loading.tap';
  const expectedKey = 'phone-loading.expected-shard';
  const tap = Number(sessionStorage.getItem(key));
  const initialURL = location.href, initialChunk = new URL(initialURL).searchParams.get('chunk');
  const documentToken = crypto.randomUUID();
  const expectedShard = flow.startsWith('select:') ? flow.slice(7) : initialChunk ?? sessionStorage.getItem(expectedKey);
  if (tap > 0 && initialChunk !== null) sessionStorage.setItem(expectedKey, expectedShard ?? initialChunk);
  const data: Capture = {tap: tap > 0 ? tap : null, control: null, rows: [], measures: [], longTasks: [], frameGaps: [], errors: [], errorDetails: [], panels: [], rowCoverage: 'visible-only'};
  Reflect.set(window, '__phoneLoading', data);
  let gridHome: {world: unknown; instance: string | null; slug: string | null} | undefined;
  const read = (value: unknown, name: string): unknown => typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
  const shown = (element: Element | null): boolean => {
    if (element === null || !element.isConnected) return false;
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.right <= 0 || bounds.top >= innerHeight || bounds.left >= innerWidth) return false;
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const nativeWitness = (): ControlWitness => {
    const probe: unknown = Reflect.get(window, '__wildshard'), world = read(probe, 'world');
    const game = read(world, 'game'), hud = read(world, 'hud'), app = read(game, 'app'), renderer = read(game, 'renderer');
    const shardProbe = read(probe, 'shard'), shardValue = read(shardProbe, 'slug'), frameValue = read(game, 'frameCount');
    const paused = read(hud, 'paused'), clockPaused = read(read(app, 'clock'), 'paused'), state = read(app, 'state');
    const canvas = read(renderer, 'domElement'), gate = read(game, 'frameGate');
    let frameGate = false;
    if (typeof gate === 'function') {const result: unknown = Reflect.apply(gate, game, []); frameGate = result === true;}
    const covers = [...document.querySelectorAll('.ws-load,.ws-launch,.ws-main,.ws-menu,.ws-grid-reveal,.ws-load-error,#wserr')]
      .filter(shown).map(element => element.id || element.className);
    const root = document.getElementById('hud');
    const hudVisible = root !== null && !root.classList.contains('intro')
      && [...root.querySelectorAll('.ws-touch-pause,.ws-game-cross,.ws-game-compass')].some(shown);
    const titleFirst = document.documentElement.classList.contains('title-first');
    const shard = typeof shardValue === 'string' ? shardValue : null;
    let home: ControlWitness['gridHome'] = null;
    if (flow === 'grid') {
      const grid = read(shardProbe, 'grid'), gridState = read(grid, 'state'), travel = read(grid, 'travelState');
      if (typeof gridState === 'function' && typeof travel === 'function') {
        if (gridHome === undefined || gridHome.world !== world) {
          // Immutable identity only once; the existing travel read below is
          // the small scalar probe, not the full per-frame census.
          const snapshot: unknown = Reflect.apply(gridState, grid, []), homeId = read(snapshot, 'home'), cells = read(snapshot, 'cells');
          const rows: readonly unknown[] = Array.isArray(cells) ? cells : [];
          const matches = rows.filter(cell => read(cell, 'instance') === homeId);
          const slug = matches.length === 1 ? read(matches[0], 'slug') : undefined;
          gridHome = {world, instance: typeof homeId === 'string' ? homeId : null, slug: typeof slug === 'string' ? slug : null};
        }
        const snapshot: unknown = Reflect.apply(travel, grid, []), live = read(read(snapshot, 'live'), 'live');
        const current = read(live, 'current'), inside = read(snapshot, 'inside'), ready = read(live, 'gameplayReady') === true;
        home = {instance: gridHome.instance, slug: gridHome.slug, current: typeof current === 'string' ? current : null,
          inside: typeof inside === 'string' ? inside : null, ready,
          entered: gridHome.instance !== null && current === gridHome.instance && inside === gridHome.instance && ready};
      }
    }
    const entered = read(hud, 'entered') === true;
    const canvasVisible = canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0 && shown(canvas);
    const blockers: string[] = [];
    if (data.tap === null) blockers.push('No real entry tap');
    if (expectedShard === null || initialChunk !== expectedShard) blockers.push('Not the intended entry document');
    if (titleFirst) blockers.push('Renderer-free title-first document');
    const enteredShard = flow === 'grid' ? home?.slug ?? null : shard;
    if (enteredShard !== expectedShard) blockers.push(`Entered shard ${enteredShard ?? 'missing'} differs from ${expectedShard ?? 'unknown target'}`);
    if (flow === 'grid' && home?.entered !== true) blockers.push('Grid home is not the entered ready current cell');
    if (!entered || paused !== false || clockPaused !== false || state !== 'play') blockers.push('Native HUD/game is not entered and unpaused');
    if (!frameGate || typeof frameValue !== 'number') blockers.push('Native drawn frame gate is not ready');
    if (!hudVisible) blockers.push('HUD is not visibly uncovered');
    if (!canvasVisible) blockers.push('Native game canvas is not visible');
    if (covers.length > 0) blockers.push(`Visible cover: ${covers.join(', ')}`);
    const witness: ControlWitness = {at: epoch(), documentToken, timeOrigin: performance.timeOrigin, initialURL, url: location.href,
      initialChunk, expectedShard, shard, titleFirst, entered, paused: typeof paused === 'boolean' ? paused : null,
      clockPaused: typeof clockPaused === 'boolean' ? clockPaused : null, frameGate, frames: typeof frameValue === 'number' ? frameValue : null,
      appState: typeof state === 'string' ? state : null, gridHome: home, hudVisible, canvasVisible, covers, blockers, valid: blockers.length === 0};
    data.lastWitness = witness;
    return witness;
  };
  Reflect.set(window, '__phoneLoadingReadControl', nativeWitness);
  const seen = new Map<string, Row>();
  let lastPanelAt = 0;
  let navigationPublished = false;
  const completedPanels = new WeakSet<Element>();
  const sample = (): void => {
    if (document.documentElement?.dataset['wsState'] === 'error') {
      data.fatal = document.querySelector('.ws-load-error')?.textContent ?? 'Application entered error state';
      data.stoppedAt ??= epoch();
      if (!data.errors.includes(data.fatal)) {
        data.errors.push(data.fatal);
        data.errorDetails?.push({message: data.fatal, source: '.ws-load-error / app state', url: location.href, at: epoch()});
      }
    }
    for (const root of document.querySelectorAll('.ws-load')) {
      const snapshot: unknown = Reflect.get(root, Symbol.for('engine.loading.snapshot'));
      let activeLabel: string | null = null;
      if (typeof snapshot === 'object' && snapshot !== null && 'rows' in snapshot && Array.isArray(snapshot.rows)) {
        data.rowCoverage = 'native-all-rows';
        const values: readonly unknown[] = snapshot.rows;
        for (const value of values) {
          if (typeof value !== 'object' || value === null) continue;
          const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
          if (typeof row['key'] !== 'string' || typeof row['ms'] !== 'number') continue;
          const start = typeof row['startedAt'] === 'number' ? performance.timeOrigin + row['startedAt'] : null;
          const end = typeof row['endedAt'] === 'number' ? performance.timeOrigin + row['endedAt'] : null;
          const state = row['state'] === 'todo' || row['state'] === 'on' || row['state'] === 'ok' ? row['state'] : undefined;
          if ('current' in snapshot && row['key'] === snapshot.current && typeof row['label'] === 'string') activeLabel = row['label'];
          seen.set(row['key'], {key: row['key'], label: String(row['label']), start, end, duration: row['ms'],
            ...(state === undefined ? {} : {state}),
            ...(start === null ? {} : {startBasis: 'native' as const}), ...(end === null ? {} : {endBasis: 'native' as const}),
            wallMs: start !== null && end !== null ? end - start : null});
        }
        // Gaps carry native elapsed time but no native absolute bounds.
        // Keep those bounds unknown rather than inferring them from a poll.
        const gaps: unknown = Reflect.get(snapshot, 'gaps');
        if (Array.isArray(gaps)) for (const [index, gap] of gaps.entries()) {
          if (typeof gap !== 'object' || gap === null) continue;
          const label: unknown = Reflect.get(gap, 'label'), ms: unknown = Reflect.get(gap, 'ms'), state: unknown = Reflect.get(gap, 'state');
          if (typeof label !== 'string' || typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || state !== 'ok' && state !== 'on') continue;
          seen.set(`gap:native:${index}`, {key: `gap:native:${index}`, label, duration: ms, state, start: null, end: null, wallMs: null});
        }
      } else {
        for (const element of root.querySelectorAll<HTMLElement>('[data-key]')) {
          const name = element.dataset['key'];
          if (name === undefined) continue;
          const label = (element.children[0]?.textContent ?? '').replace(/^▸\s*(?:\d+\s*·\s*)?/u, '').trim();
          const id = name !== 'gap' ? name : /quick steps/u.test(label) ? 'quick-steps' : `gap:${label}`;
          const duration = Number(element.dataset['ms']);
          const prior = seen.get(id), at = epoch();
          const rawStart = element.dataset['startedAt'], rawEnd = element.dataset['endedAt'];
          const knownStart = rawStart !== undefined && rawStart !== '' && Number.isFinite(Number(rawStart));
          const knownEnd = rawEnd !== undefined && rawEnd !== '' && Number.isFinite(Number(rawEnd));
          const start = knownStart ? performance.timeOrigin + Number(rawStart) : prior?.start ?? at;
          const complete = element.classList.contains('ok');
          const end = knownEnd ? performance.timeOrigin + Number(rawEnd)
            : complete ? prior?.duration === duration ? prior.end ?? at : at : null;
          seen.set(id, {key: id, label, detail: element.children[1]?.textContent ?? '', start, end,
            startBasis: knownStart ? 'native' : 'observed', ...(end === null ? {} : {endBasis: knownEnd ? 'native' as const : 'observed' as const}),
            state: complete ? 'ok' : 'on', duration: Number.isFinite(duration) ? duration : 0, wallMs: end === null ? null : end - start});
        }
      }
      const at = epoch();
      const navigation = root instanceof HTMLElement && Object.hasOwn(root.dataset, 'navigation');
      const download = Number.parseFloat(root.querySelector('[data-el="dlPct"]')?.textContent ?? '');
      if (download < 100) completedPanels.delete(root);
      const firstCompletion = download === 100 && !completedPanels.has(root);
      if ((at - lastPanelAt >= 100 || navigation && !navigationPublished || firstCompletion) && data.control === null) {
        const text = (field: string): string => root.querySelector(`[data-el="${field}"]`)?.textContent ?? '';
        const bytes = (fieldName: string): number | null => {
          const raw = root instanceof HTMLElement ? root.dataset[fieldName] : undefined;
          if (raw === undefined || raw === '') return null;
          const value = Number(raw); return Number.isSafeInteger(value) && value >= 0 ? value : null;
        };
        const panel: PanelRow = {at, clock: text('clock'), download: Number.isFinite(download) ? download : null, downloadFact: text('dlFact'),
          header: text('suFact'), wait: text('foot'), step: root instanceof HTMLElement ? root.dataset['step'] ?? '' : '', activeLabel, documentToken, navigation,
          content: {declaredBytes: bytes('declaredBytes'), pendingBytes: bytes('pendingBytes'), entryDownloadBytes: bytes('entryDownloadBytes'),
            ...(!(root instanceof HTMLElement) || root.dataset['readBytes'] === undefined ? {} : {readBytes: bytes('readBytes'),
              readCachedBytes: bytes('readCachedBytes'), readUnknownSourceBytes: bytes('readUnknownSourceBytes'), readsClosed: root.dataset['readsClosed'] === 'true'}),
            ...(!(root instanceof HTMLElement) || root.dataset['restoredBytes'] === undefined ? {} : {restoredBytes: bytes('restoredBytes')})}};
        data.panels?.push(panel);
        if (download === 100) completedPanels.add(root);
        if (navigation) {
          navigationPublished = true;
          const publish: unknown = Reflect.get(window, '__phoneLoadingPanel');
          if (typeof publish === 'function') void Promise.resolve(Reflect.apply(publish, window, [panel])).catch(() => undefined);
        }
        lastPanelAt = at;
      }
    }
    data.rows = [...seen.values()];
  };
  const mark = (entry: PerformanceEntry): Mark => ({name: entry.name, start: performance.timeOrigin + entry.startTime,
    duration: entry.duration, detail: entry instanceof PerformanceMeasure ? entry.detail : null});
  for (const type of ['measure', 'longtask']) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) (type === 'measure' ? data.measures : data.longTasks).push(mark(entry));
    }).observe({type, buffered: true});
  }
  new MutationObserver(sample).observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
  const tapped = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const selector = flow === 'grid' ? '.ws-main-grid' : '.ws-menu-play';
    if (target.closest(selector) === null) return;
    if (data.tap !== null) return;
    sessionStorage.removeItem(expectedKey);
    data.tap = epoch(); sessionStorage.setItem(key, String(data.tap));
    const publish: unknown = Reflect.get(window, '__phoneLoadingTap');
    if (typeof publish === 'function') Reflect.apply(publish, window, [data.tap]);
  };
  window.addEventListener('pointerup', tapped, true);
  window.addEventListener('click', tapped, true);
  document.addEventListener('ws:control-ready', () => {sample(); data.controlEventAt = epoch();}, {once: true});
  window.addEventListener('error', event => {data.errors.push(event.message);
    data.errorDetails?.push({message: event.message, source: 'window.error', url: event.filename, at: epoch()});});
  window.addEventListener('unhandledrejection', event => {data.errors.push(String(event.reason));
    data.errorDetails?.push({message: String(event.reason), source: 'window.unhandledrejection', url: location.href, at: epoch()});});
  let last = performance.now();
  let lastCheck = 0, firstFrame: number | null = null, qualifiedWorld: unknown;
  const frame = (now: number): void => {
    if (Reflect.get(window, '__phoneLoading') !== data) return;
    if (now - last > 50) data.frameGaps.push({start: performance.timeOrigin + last, duration: now - last});
    last = now;
    if (data.controlEventAt !== undefined && now - lastCheck >= 100 && data.fatal === undefined) {
      lastCheck = now;
      const witness = nativeWitness(), world = read(Reflect.get(window, '__wildshard'), 'world');
      if (!witness.valid) {firstFrame = null; qualifiedWorld = undefined;}
      else if (firstFrame === null || qualifiedWorld !== world) {firstFrame = witness.frames; qualifiedWorld = world;}
      else if (data.control === null && witness.frames !== null && witness.frames > firstFrame) {
        data.control = witness.at; data.controlWitness = witness;
      }
    }
    if (data.fatal === undefined) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
