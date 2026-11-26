// Shared browser-side loading-card observer for manual proofs and T1.
/** Browser-side recorder: one row per bar change, with the LS1 counters at that moment. */
export function recordBars() {
  /** @type {import('./loading-bar-rule.mjs').BarRow[]} */
  const rows = []
  Reflect.set(window, '__barLog', rows)
  /** @type {{t: number, startBytes: number, startTotal: number, startFiles: number, serverSteps: number, serverFiles: number, serverBytes: number}[]} */
  const counts = []
  Reflect.set(window, '__countLog', counts)
  const startSteps = [
    'app:document-and-module-graph',
    'app:page-entry-import',
    'app:tables-import-and-prepare',
    'app:tier-menu-download-imports',
    'app:three-import',
    'app:main-import',
    'app:selected-discovery',
  ]
  const timing = () =>
    /** @type {import('../shared/engine/boot/timing').BootTiming|undefined} */ (
      Reflect.get(window, '__bootTiming')
    )
  const start = () => {
    const t = timing(),
      text = document.getElementById('boot-module-files')?.textContent
    const inventory =
      /** @type {{common?:[string,number][]}} */ (
        JSON.parse(
          text === undefined || text === null || text === '' ? '{}' : text,
        )
      ).common ?? []
    const modules = new Map(
      inventory.map(([url, bytes]) => [
        new URL(url, location.href).href,
        bytes,
      ]),
    )
    const received = new Map()
    // index.html's Start painter: a row with no body size (WebKit's cached or service-worker answer) counts its compiler
    // size, unless it says responseStatus 0 (Chromium's failed fetch)
    for (const row of t?.resources ?? [])
      if (
        row.realm === 'page' &&
        typeof row.url === 'string' &&
        (Number(row.decodedBodySize) > 0 || row.responseStatus !== 0)
      ) {
        const size = modules.get(row.url),
          decoded =
            typeof row.decodedBodySize === 'number' ? row.decodedBodySize : 0
        if (size !== undefined)
          received.set(row.url, decoded > 0 ? Math.min(size, decoded) : size)
      }
    return {
      kind: 'start',
      adopted: (t?.entries ?? []).some(
        row => row.operation === 'app:loading-adopt',
      ),
      done: startSteps.filter(op =>
        (t?.entries ?? []).some(
          row =>
            row.operation === op &&
            row.end !== null &&
            row.result === 'complete',
        ),
      ).length,
      total: startSteps.length,
      bytes: [...received.values()].reduce((a, b) => a + b, 0),
      byteTotal: [...modules.values()].reduce((a, b) => a + b, 0),
      files: received.size,
    }
  }
  /** @param {string} bar @returns {import('./loading-bar-rule.mjs').ProducerReading|undefined} */
  const evidence = bar => {
    const t = timing()
    if (bar === 'start') return start()
    if (bar === 'download') {
      const row = t?.work?.download?.()
      // the head's own ratio (engine src/shared/engine/boot/timing.ts downloadShown): wire sizes when the build declares them
      if (row === undefined) return undefined
      const wire =
        /** @type {{totalBytes:number,completedBytes:number,arrivingBytes?:number}|undefined} */ (
          Reflect.get(row, 'wire')
        )
      return {
        kind: 'download',
        done:
          wire === undefined
            ? row.completedBytes
            : Math.min(
                wire.totalBytes,
                wire.completedBytes + (wire.arrivingBytes ?? 0),
              ),
        total: wire === undefined ? row.totalBytes : wire.totalBytes,
        complete: row.complete,
        known: row.progressKnown !== false,
        inline: !(t?.entries ?? []).some(
          entry => entry.operation === 'app:loading-adopt',
        ),
      }
    }
    if (bar === 'load') {
      const row = t?.work?.load?.()
      return row === undefined
        ? undefined
        : {
            kind: 'load',
            configured: row.path !== 'pending',
            rows: row.rows.map(({ state, fraction, weight }) => ({
              state,
              fraction,
              weight,
            })),
            complete: (t?.entries ?? []).some(
              entry => entry.operation === 'app:control-ready',
            ),
          }
    }
    return undefined
  }
  const seen = new Map()
  let step = '',
    ready = false,
    previousCount = '',
    firstFrame = false
  Reflect.set(window, '__firstLoadingFrame', null)
  /** @param {HTMLElement} fill */
  const sampleBar = fill => {
    const bar = fill.dataset.phaseBar ?? '',
      pct = Number.parseFloat(fill.style.width || '0')
    if (seen.get(bar) === pct) return
    seen.set(bar, pct)
    rows.push({
      t: performance.now(),
      bar,
      pct,
      step,
      atomic: 0,
      bytes: 0,
      files: 0,
      source: evidence(bar),
    })
  }
  const hooked = new WeakSet()
  /** @param {HTMLElement} fill */
  const hook = fill => {
    if (hooked.has(fill)) return
    hooked.add(fill)
    const style = fill.style,
      read = style.getPropertyValue.bind(style),
      write = style.setProperty.bind(style)
    // Chromium exposes width as an own CSS named property; WebKit puts the
    // accessor on CSSStyleProperties. Forward both through native CSSOM on
    // this actual bar only, before the inline document writer executes.
    Object.defineProperty(style, 'width', {
      configurable: true,
      get: () => read('width'),
      set: value => {
        write('width', value)
        sampleBar(fill)
      },
    })
  }
  const sample = () => {
    const card = document.querySelector('.ws-load')
    if (!(card instanceof HTMLElement)) return
    if (!firstFrame) {
      firstFrame = true
      requestAnimationFrame(() => {
        Reflect.set(window, '__firstLoadingFrame', {
          name: card.querySelector('[data-el=slug]')?.textContent,
          art: getComputedStyle(document.documentElement)
            .getPropertyValue('--ws-load-portrait')
            .trim(),
          shell: Object.hasOwn(card.dataset, 'shell'),
        })
      })
    }
    const t = timing(),
      first = start()
    let serverSteps = 0,
      serverFiles = 0,
      serverBytes = 0
    const completed = (t?.entries ?? []).filter(
      row =>
        row.realm !== 'page' &&
        row.operation.startsWith('server:') &&
        row.result === 'complete' &&
        row.end !== null,
    )
    serverSteps = completed.length
    serverFiles = completed.filter(row =>
      row.operation.startsWith('server:verified-input:'),
    ).length
    for (const row of Object.values(t?.counters ?? {}))
      if (row.unit === 'verified-input-bytes') serverBytes += row.loaded
    const reading = {
      startBytes: first.bytes,
      startTotal: first.byteTotal,
      startFiles: first.files,
      serverSteps,
      serverFiles,
      serverBytes,
    }
    const identity = JSON.stringify(reading)
    if (identity !== previousCount) {
      previousCount = identity
      counts.push({ t: performance.now(), ...reading })
    }
    const now = card.dataset.step ?? ''
    if (now !== step) {
      step = now
      rows.push({
        t: performance.now(),
        bar: 'step',
        pct: 0,
        step,
        atomic: 0,
        bytes: 0,
        files: 0,
      })
    }
    if (!ready && Object.hasOwn(card.dataset, 'ready')) {
      ready = true
      Reflect.set(window, '__readyAt', performance.now())
    }
    for (const fill of card.querySelectorAll('[data-phase-bar]'))
      if (fill instanceof HTMLElement) {
        hook(fill)
        sampleBar(fill)
      }
  }
  new MutationObserver(sample).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-step', 'data-ready'],
  })
  document.addEventListener('DOMContentLoaded', sample, { once: true })
}
