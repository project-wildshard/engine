/** Check the requested diagnostic independently of the measurement host.
 * @param {readonly string[]} profiles @param {{dockOnly?:boolean,coldOnly?:boolean}} run */
export function passBreakdownAllowed(profiles, run) {
  return run.dockOnly === true && run.coldOnly === true && profiles.every(name => name.startsWith('desktop-'));
}

/** @param {string | undefined} bench */
export function requirePassBench(bench) {
  if (bench !== '1') throw new Error('Live pass breakdown needs WS_BENCH=1');
}

/**
 * CPU submission inside each composer pass. Serialized into the browser and
 * attached only after control, so the probe shares the stock route's boot.
 * @param {{render:(...args:unknown[])=>void, passes:{render:(...args:unknown[])=>void, name?:string, effects?:{name:string}[]}[]}} composer
 * @param {{shadowMap:{render:(...args:unknown[])=>void}}} renderer
 */
export function observePasses(composer, renderer) {
  /** @type {{name:string, current:number, frames:number[]}[]} */
  const rows = [];
  /** @type {(() => void)[]} */
  const undo = [];
  let elapsed = 0, active = false;
  /** @param {{render:(...args:unknown[])=>void}} owner @param {string} name */
  const attach = (owner, name) => {
    const row = { name, current: 0, frames: /** @type {number[]} */ ([]) };
    rows.push(row);
    const original = owner.render;
    /** @type {(this:typeof owner, ...args:unknown[])=>void} */
    const timedPass = function timedPass(...args) {
      if (!active) { original.apply(this, args); return; }
      const before = performance.now(), children = elapsed;
      try { original.apply(this, args); }
      finally {
        const ms = performance.now() - before;
        row.current += Math.max(0, ms - (elapsed - children));
        elapsed = children + ms;
      }
    };
    owner.render = timedPass;
    undo.push(() => { owner.render = original; });
  };
  for (const [index, pass] of composer.passes.entries()) {
    const effects = pass.effects?.map(effect => effect.name).join('+');
    const name = effects === undefined || effects === '' ? pass.name ?? 'unnamed pass' : effects;
    attach(pass, `${index + 1} ${name}`);
  }
  attach(renderer.shadowMap, 'shadows');
  const render = composer.render;
  /** @type {{ageMs:number, submitMs:number, passes:Record<string,number>}[]} */
  const slow = [];
  /** @type {number[]} */
  const total = [];
  const start = performance.now();
  /** @type {(this:typeof composer, ...args:unknown[])=>void} */
  const timedComposer = function timedComposer(...args) {
    elapsed = 0; active = true;
    const frameStart = performance.now();
    try { render.apply(this, args); }
    finally {
      const ms = performance.now() - frameStart;
      active = false;
      total.push(ms);
      if (ms >= 16 && slow.length < 64) slow.push({
        ageMs: Math.round(frameStart - start), submitMs: ms,
        passes: Object.fromEntries(rows.map(row => [row.name, row.current])),
      });
      for (const row of rows) { row.frames.push(row.current); row.current = 0; }
    }
  };
  composer.render = timedComposer;
  /** @param {number[]} frames */
  const summary = frames => {
    frames.sort((a, b) => a - b);
    const at = (/** @type {number} */ part) => frames[Math.floor((frames.length - 1) * part)] ?? null;
    return { frames: frames.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: frames.at(-1) ?? null };
  };
  return () => {
    composer.render = render;
    for (const close of undo) close();
    const passes = [];
    for (const row of rows) passes.push({ name: row.name, ...summary(row.frames) });
    return { total: summary(total), passes, slow };
  };
}
