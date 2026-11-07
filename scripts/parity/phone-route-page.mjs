// G745: read actual page/physics/render owners; never install a replacement game service.

/** Capture the immutable home once per grid owner. Per-frame waiting reads
 * only the fresh travel port, without constructing the full debug census.
 * @returns {()=>boolean} */
export function phoneGridEntryCondition() {
  /** @type {object|null} */ let owner=null;
  /** @type {string|null} */ let home=null;
  return ()=>{
    const api=window.__wildshard;
    if(!api?.world)return false;
    const grid=api.shard.grid;
    /** @type {{inside:string|null,live:import('./phone-route.mjs').PhoneGrid['live']}|undefined} */ let travel;
    if(typeof grid==='object'&&grid!==null&&'state' in grid&&typeof grid.state==='function'
      &&'travelState' in grid&&typeof grid.travelState==='function') {
      if(grid!==owner) {
        /** @type {unknown} */ const state=grid.state();
        if(typeof state==='object'&&state!==null&&'home' in state&&typeof state.home==='string') {
          owner=grid;home=state.home;
        }
      }
      travel=grid.travelState();
    }
    const reveal=document.querySelector('.ws-grid-reveal');
    if(reveal)reveal.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    return owner===grid&&travel?.live?.live?.gameplayReady===true&&travel.inside===home&&api.requireWorld().game.frameGate();
  };
}

/** RWI has no Playwright tap port: dispatch the same touch/control events,
 * including pointerdown (HOVER binds there), under emulateUserGesture.
 * @param {string} selector */
export function phoneTouchButton(selector) {
  const button = document.querySelector(selector);
  if (!(button instanceof HTMLButtonElement) || button.disabled || button.getClientRects().length === 0) throw new Error('Unavailable actual phone control');
  const rect = button.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
    clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
  button.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
  button.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
  button.click();
  return true;
}

/** Failure-only evidence also works before a world/grid exists. Read the
 * existing loading snapshot and native timings without installing observers. */
export function phoneLoadingObservation() {
  const root = /** @type {HTMLElement|null} */ (document.querySelector('.ws-load'));
  const { step } = root?.dataset ?? {};
  /** @param {string} key */
  const text = key => root?.querySelector(`[data-el="${key}"]`)?.textContent ?? null;
  /** @type {unknown} */
  const timeline = root === null ? null : Reflect.get(root, Symbol.for('engine.loading.snapshot')) ?? null;
  const at = performance.now();
  const observer = Reflect.get(window, '__phoneRouteObserver') ?? null;
  // Resource Timing contains settled reads only. Retain the existing registry's
  // live transport identities without importing code or invoking retry owners.
  const state = /** @type {import('../../src/shared/engine/boot/loadingWaits').LoadingWaitState|undefined} */ (Reflect.get(document, Symbol.for('engine.loading.waits.v1')));
  const waits = state?.version === 1 && typeof state.pending?.values === 'function'
    ? [...state.pending.values()].map(row => ({ id: row.id, label: row.label, kind: row.kind, step: row.step,
      resource: row.resource ?? null, startedAt: row.startedAt, ageMs: Math.max(0, at - row.startedAt),
      progressAgeMs: Math.max(0, at - row.progressAt), loadedBytes: row.loadedBytes, totalBytes: row.totalBytes })) : null;
  return { at, url: location.href, readyState: document.readyState, waits, observer,
    loading: root === null ? null : { step: step ?? null, clock: text('clock'),
      download: text('dlFact'), setup: text('suFact'), wait: text('foot'), timeline },
    resources: performance.getEntriesByType('resource').map(entry => {
      const resource = /** @type {PerformanceResourceTiming} */ (entry);
      return { name: resource.name, kind: resource.initiatorType, start: resource.startTime,
        duration: resource.duration, responseStart: resource.responseStart, responseEnd: resource.responseEnd,
        transferBytes: resource.transferSize, encodedBytes: resource.encodedBodySize, decodedBytes: resource.decodedBodySize };
    }),
    measures: performance.getEntriesByType('measure').map(entry => ({ name: entry.name, start: entry.startTime, duration: entry.duration })) };
}

/** Read the rendered G718 pill and completed draws, not simulation ticks or p50. */
export function phoneRouteObservation() {
  const api = window.__wildshard, world = api?.world;
  if (world === undefined) return null;
  const exposed = api.shard.grid;
  if (typeof exposed !== 'object' || exposed === null || !('state' in exposed) || typeof exposed.state !== 'function') throw new Error('Phone route requires grid state');
  const grid = /** @type {import('./phone-route.mjs').PhoneGrid} */ (exposed.state());
  const live = grid.live?.live;
  const history = /** @type {unknown} */ (Reflect.get(window, '__phoneRouteFaults'));
  const errors = Array.isArray(history) ? history.filter((/** @type {unknown} */ row) => typeof row === 'string') : ['Missing cold error observer'];
  return { at: performance.now(), frame: world.game.frameCount, frameAt: world.game.frameRafTime,
    ready: live?.gameplayReady === true && world.game.frameGate() && !world.hud.paused,
    current: live?.current ?? null, inside: grid.inside, home: grid.home, pitch: grid.pitch,
    feet: live?.worldFeet ?? null, cells: grid.cells, grain: grid.frame?.chain.fx?.grain ?? 0,
    frameAvailable: grid.frame !== null, hover: world.player.hover,
    fps: Number(document.querySelector('.ws-perf > b')?.textContent), pill: document.querySelector('.ws-perf')?.textContent ?? null,
    fatal: [...errors, ...document.querySelectorAll('#wserr,.ws-load-error,.ws-game-dev-alert,[data-boot-fatal]')].map(node => typeof node === 'string' ? node : node.textContent),
    contextLost: world.game.renderer.getContext().isContextLost() };
}

/** First geometric Night Market entry: take full tile evidence once, not a debug census every frame.
 * @param {string} instance */
export function watchPhoneEntry(instance) {
  const api = window.__wildshard, world = api.requireWorld();
  const exposed = api.shard.grid;
  if (typeof exposed !== 'object' || exposed === null || !('travelState' in exposed) || typeof exposed.travelState !== 'function' || !('state' in exposed) || typeof exposed.state !== 'function') throw new Error('Missing live grid travel port');
  const readTravel = exposed.travelState, read = exposed.state;
  /** @type {{done:boolean, entry:unknown}} */ const evidence = { done: false, entry: null };
  Reflect.set(window, '__phoneRouteEntry', evidence);
  let lastFrame = -1;
  const frame = () => {
    if (evidence.done || window.__wildshard !== api) return;
    requestAnimationFrame(frame);
    if (world.game.frameCount === lastFrame) return;
    lastFrame = world.game.frameCount;
    const travel = /** @type {{inside:string|null}} */ (readTravel());
    if (travel.inside !== instance) return;
    const state = /** @type {import('./phone-route.mjs').PhoneGrid} */ (read());
    const cell = state.cells.find(row => row.instance === instance);
    evidence.entry = { at: performance.now(), frame: world.game.frameCount, inside: state.inside,
      current: state.live?.live.current, ready: state.live?.live.gameplayReady,
      cell: cell === undefined ? null : { ...cell, cell: [...cell.cell], drawn: { ...cell.drawn } }, grain: state.frame?.chain.fx?.grain ?? 0 };
    evidence.done = true;
  };
  requestAnimationFrame(frame);
}

/** Find a player-blocking vertical wall patch in the shipping collision mesh.
 * The plot's collide_ geometry is a triangle mesh, not separate box colliders. */
export function phoneWallTarget() {
  const api = window.__wildshard, world = api.requireWorld(), player = world.player, physics = world.physics;
  const exposed = api.shard.grid;
  if (typeof exposed !== 'object' || exposed === null || !('state' in exposed) || typeof exposed.state !== 'function') throw new Error('Missing wall approach grid');
  const state = /** @type {import('./phone-route.mjs').PhoneGrid} */ (exposed.state());
  const feet = state.live?.live.worldFeet;
  if (feet === undefined) throw new Error('Missing actual wall approach feet');
  const origin = { x: player.position.x, y: player.position.y + .8, z: player.position.z };
  const climbAngle=player.motor.opts.maxClimbDeg*Math.PI/180;
  if(!Number.isFinite(climbAngle)||climbAngle<=0||climbAngle>=Math.PI/2)throw new Error('Invalid actual player climb law');
  /** @param {{x:number,z:number}} direction @param {number} vertical @param {number} side */
  const ray = (direction,vertical=0,side=0) => physics.world.castRayAndGetNormal(
    new physics.R.Ray({x:origin.x-direction.z*side,y:origin.y+vertical,z:origin.z+direction.x*side},{...direction,y:0}),120,true,
    physics.R.QueryFilterFlags.EXCLUDE_SENSORS,player.motor.collider.collisionGroups(),player.motor.collider,undefined,
    collider=>physics.colliderTag(collider)?.material!=='edge');
  const walls = [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}].map(direction=>({direction,hit:ray(direction,0,0)}))
    .filter(row=>{
      const hit=row.hit;if(hit===null||hit.timeOfImpact<1||Math.abs(hit.normal.y)>.2)return false;
      // A 2m-wide, 1.2m-tall vertical patch on the SAME native collider;
      // no assumption that the collider is a box or has retained JS tags.
      return [[1.2,0],[0,-1],[0,1]].every(([up,side])=>{
        const sample=ray(row.direction,up,side);
        if(sample===null||sample.collider.handle!==hit.collider.handle)return false;
        // The authored plinth's upper face is beveled. It must still be
        // steeper than this player's real climb limit, not perfectly vertical.
        const normalLimit=up===0?.2:Math.cos(climbAngle),runLimit=up===0?.15:up/Math.tan(climbAngle);
        return Math.abs(sample.normal.y)<normalLimit&&Math.abs(sample.timeOfImpact-hit.timeOfImpact)<=runLimit;
      });
    }).sort((a,b)=>(a.hit?.timeOfImpact??Infinity)-(b.hit?.timeOfImpact??Infinity));
  const wall=walls[0];
  if(wall?.hit===null||wall?.hit===undefined)throw new Error('No real building wall on the public approach');
  const tag=physics.colliderTag(wall.hit.collider);
  const distance=Math.max(0,wall.hit.timeOfImpact-10);
  return { direction:wall.direction, collider:wall.hit.collider.handle,material:tag?.material??null,
    surface:{width:2,height:1.2,normal:{x:wall.hit.normal.x,y:wall.hit.normal.y,z:wall.hit.normal.z}},
    approach:{x:feet.x+wall.direction.x*distance,z:feet.z+wall.direction.z*distance} };
}

/** Wall probe uses the actual board and held forward input; no pose/enterNow.
 * @param {number} milliseconds @param {import('./phone-route.mjs').PhoneWallTarget} target */
export async function phoneBoardWall(milliseconds, target) {
  const world = window.__wildshard.requireWorld(), player = world.player, input = world.game.app.input;
  const start = performance.now(), startedFrame = world.game.frameCount, yaw = player.yaw, hover = player.hover;
  const from = { x: player.position.x, y: player.position.y, z: player.position.z }, physics = world.physics;
  const {direction}=target;
  const hit = physics.world.castRay(new physics.R.Ray({ x: from.x, y: from.y + .8, z: from.z }, { ...direction,y:0 }), 25, true, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, player.motor.collider.collisionGroups(), player.motor.collider);
  if (hit === null || hit.collider.handle !== target.collider) throw new Error('Original building wall unavailable after actual approach');
  /** @type {{ms:number,x:number,z:number,hover:boolean,frame:number}[]} */ const samples = [];
  if (!player.hover) throw new Error('Board must be mounted through the actual touch control');
  player.yaw = Math.atan2(-direction.x,-direction.z); input.setHeld('move.forward', true);
  const stop = world.game.watchFrames(() => { samples.push({ ms: performance.now() - start, x: player.position.x, z: player.position.z, hover: player.hover, frame: world.game.frameCount }); });
  try {
    await new Promise(resolve => { setTimeout(resolve, milliseconds); });
  } finally { input.clear(); stop(); }
  // Sample on real game frames, including the preceding held-input window.
  return { from, wallDistance:hit.timeOfImpact, direction,collider:target.collider,material:target.material,surface:target.surface,elapsedMs: performance.now() - start, startedFrame, finalFrame: world.game.frameCount,
    final: { x: player.position.x, y: player.position.y, z: player.position.z }, hover: player.hover, samples, previous: { yaw, hover } };
}

/** Lightweight early shell witness: actual hero image loaded plus a presented animation frame.
 * The bootstrap follows navigation; only its original title document samples the hero.
 * @param {string} [titleURL] */
export function installPhoneTitlePaint(titleURL) {
  // Keep late entry reads: WebKit defaults to only the first 250 resources.
  performance.setResourceTimingBufferSize(10_000);
  /** @type {import('./phone-route.mjs').PhoneTitlePhases} */
  const phases = { visibleMs: null, probeStartedMs: null, probeLoadedMs: null, firstFrameMs: null, resources: [] };
  /** @type {import('./phone-route.mjs').PhoneReceipt['paint']} */
  const evidence = { heroMs: null, fcpMs: null, heroURL: null, phases };
  Reflect.set(window, '__phoneRoutePaint', evidence);
  /** @type {string[]} */ const faults = [];
  Reflect.set(window, '__phoneRouteFaults', faults);
  // Attribute the harness itself before blaming application preparation.
  // Scalar counters only; no extra observer, timer, census or retained nodes.
  const observer = { batches: 0, records: 0, scans: 0, scanMs: 0, heroPolls: 0, heroMs: 0 };
  Reflect.set(window, '__phoneRouteObserver', observer);
  window.addEventListener('error', event => { faults.push(event.message); });
  window.addEventListener('unhandledrejection', event => { faults.push(String(event.reason)); });
  new MutationObserver(records => {
    const start = performance.now();
    observer.batches++; observer.records += records.length; observer.scans++;
    for (const node of document.querySelectorAll('#wserr,.ws-load-error,.ws-game-dev-alert,[data-boot-fatal]')) {
      const text = node.textContent ?? 'Fatal UI'; if (!faults.includes(text)) faults.push(text);
    }
    observer.scanMs += performance.now() - start;
  }).observe(document, { childList: true, subtree: true, characterData: true });
  // Keep error collection in every owned document. A grid document has no
  // title hero, so the inherited bootstrap must not poll it throughout play.
  if (titleURL !== undefined && location.href !== titleURL) return;
  const sample = () => {
    if (evidence.heroMs !== null) return;
    const start = performance.now(); observer.heroPolls++;
    const hero = [...document.querySelectorAll('.ws-launch-hero,.ws-main-hero')].find(node => node.getClientRects().length > 0);
    observer.heroMs += performance.now() - start;
    if (hero === undefined) { requestAnimationFrame(sample); return; }
    const match = /url\(["']?([^"')]+)["']?\)/u.exec(getComputedStyle(hero).backgroundImage);
    if (match?.[1] === undefined) { requestAnimationFrame(sample); return; }
    phases.visibleMs = performance.now();
    const image = new Image(); evidence.heroURL = new URL(match[1], location.href).href;
    image.onload = () => {
      // Retain the original probe and two rAFs. These clocks explain its delay;
      // they do not claim a CSS decode or native compositor timestamp.
      phases.probeLoadedMs = performance.now();
      requestAnimationFrame(() => {
        phases.firstFrameMs = performance.now();
        requestAnimationFrame(() => {
          evidence.heroMs = performance.now();
          evidence.fcpMs = performance.getEntriesByType('paint').find(row => row.name === 'first-contentful-paint')?.startTime ?? null;
          phases.resources = performance.getEntriesByType('resource').filter(row => row.name === evidence.heroURL).map(entry => {
            const resource = /** @type {PerformanceResourceTiming} */ (entry);
            return { kind: resource.initiatorType, start: resource.startTime, responseStart: resource.responseStart, responseEnd: resource.responseEnd,
              transferBytes: resource.transferSize, encodedBytes: resource.encodedBodySize, decodedBytes: resource.decodedBodySize };
          });
        });
      });
    };
    image.onerror = () => { evidence.heroMs = -1; };
    phases.probeStartedMs = performance.now();
    image.src = evidence.heroURL;
  };
  requestAnimationFrame(sample);
}
