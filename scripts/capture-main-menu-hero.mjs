/** G332: real canvas-only hero candidates; never changes the shipped menu or scene look.
 * node scripts/capture-main-menu-hero.mjs [--round=1|aerial|landscape|square] --out=<scratch directory>
 * --round=landscape (G336 round 3): the five landscapeHeroPlan poses at 2560×1440 and 1920×1080, desktop tier, DSF 1.
 * --round=square (G344): squareHeroPlan at a phone-1x lens, the square poses at 2048×2048 and 1440×1440 and the
 *   landscape ones at 2560×1440 and 1920×1080, desktop tier, DSF 1; each pose's fovDegrees is the capture camera's only.
 * --round=near (G342 / G385): the near tier B, raw and unlabelled (the shipped game: since G607 every cell on its near
 *   view), four road views from the roundabout to each crossroads cell, on iPhone 16 Pro portrait and 1920×1080 desktop;
 *   files B-<pose>-<device>.png. (A, the far proxy only, went in G385; C, the every-cell pin, is the game since G607.)
 * --round=near also shoots the shipped hero (round 6's SQ-NE-b, G383, after the road views; never entered, O24). Every
 *   frame records each cell's real tier (grid.state().cells[].shows / drawn: near, far proxy, tiles, playing) and the
 *   near tier's own readout (frame.near), for the labels.
 * --round=5 (G372): round5HeroPlan (above Nalati's centre looking toward Driftwood) with the near tier (B, shipped).
 * --round=6 (G379 / G380): round6HeroPlan (above Nalati's far edge, across it to Driftwood), every cell near.
 * --round=5x5 (G536): grid5x5HeroPlan, the whole 5 × 5 at the phone-1x square lens on the PHONE tier at render scale 2
 *   (720 × 720 CSS at DSF 2: a 1440 × 1440 canvas, the portrait band's size); every cell on its shipped tier, no pin
 *   (pinning every cell near reads the same: from 1.5–3 km the engine's distance fog, not the tier, pales the cells).
 * --round=far (G575 / G576 round 36): farVariantPlan (the shipped hero SQ-NE-b, the 5 × 5 overview A, one outer road) on
 *   iPhone 16 Pro portrait and 1920×1080 desktop, shipped tiers, one variant per run: --variant=<label> names the files
 *   (G607 shipped round 36's D: every cell near, no far haze or hologram fade, a 6 km far plane). Each shot records the frame rate over 4 s, the JS heap and the renderer + GPU processes' footprint (Chromium) for its label.
 *   The player stays on the session's road point for every view (re-posing the player in the grid loses the free camera).
 *   --url=<preview> captures an already served build (a local variant build in a mirror slot) instead of building HEAD.
 * --round=4 (G343): round4HeroPlan (above Driftwood, Nalati and Pine, aimed across the roundabout; never the template)
 *   with the near tier (B, shipped); the square round's sizes and lenses.
 *   --enter stands the player in the cell under the eye first (enterOver); --only=<ids> / --sessions=<keys> narrow a re-shoot.
 *   --shipped-framing keeps G625's exact eye (805,520,0), target (0,0,0) and 62°/43° lenses after grid pitch changes;
 *   --shift=<metres> slides it along its heading toward the far rows (OB9).
 *   --pose=<id>:<ex,ey,ez>:<tx,ty,tz>[:<px,pz>] (round near) shoots one view of your own instead of the road views and
 *   the hero, the player standing on the roundabout or at <px,pz>.
 * --tree builds the working tree instead of a clean HEAD export (a change not yet committed, e.g. during a push freeze).
 * --rev=<commit> builds a clean export of that commit instead (a before / after pair on one base, e.g. an unpushed commit object).
 * Owns one clean --head preview and one muted browser-lane capture, then stops both.
 * Entry and calibrated pose follow progress/shard-platform/look28/capture.mjs.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { devices } from 'playwright';
import { launchMemoryBrowser } from './chromium-memory-browser.mjs';
import { saveFixture } from './debug-settings.mjs';
import { gridFloorDocumentIdentity } from './frame-floor-grid.mjs';
import { gitCommonPath } from './git-common.mjs';

const root = resolvePath(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = resolvePath(flag('out', join(tmpdir(), `main-menu-hero-${process.pid}`)));
const script = import.meta.filename;
const round = flag('round', '1');
if (!['1', 'aerial', 'landscape', 'square', 'near', '4', '5', '6', '5x5', 'far'].includes(round)) throw new Error('Capture round must be 1, aerial, landscape, square, near, 4, 5, 6, 5x5 or far');
const serveOwner = process.env.SERVE_OWNER ?? 'sp-x2-g332';

/** G575 round 36: the footprint (MB) of the browser's renderer and GPU processes (libproc phys_footprint, macOS). */
const FOOTPRINT_PY = String.raw`
import ctypes, json, sys
class R(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_ubyte * 16)] + [(n, ctypes.c_uint64) for n in ('user_time','system_time','pkg_idle_wkups','interrupt_wkups','pageins','wired_size','resident_size','phys_footprint','proc_start_abstime','proc_exit_abstime')]
lib = ctypes.CDLL('/usr/lib/libproc.dylib'); out = {}
for p in sys.argv[1:]:
    u = R()
    out[p] = u.phys_footprint if lib.proc_pid_rusage(int(p), 0, ctypes.byref(u)) == 0 else None
print(json.dumps(out))
`;
async function farMetrics(browser, page) {
  const fps = await page.evaluate(() => new Promise(resolve => {
    let frames = 0; const start = performance.now();
    const tick = () => { frames++; if (performance.now() - start < 4000) requestAnimationFrame(tick); else resolve(frames * 1000 / (performance.now() - start)); };
    requestAnimationFrame(tick);
  }));
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const info = await (await browser.newBrowserCDPSession()).send('SystemInfo.getProcessInfo');
  const pids = info.processInfo.filter(row => row.type === 'renderer' || row.type === 'GPU');
  const sizes = JSON.parse(await command('python3', ['-c', FOOTPRINT_PY, ...pids.map(row => String(row.id))], root));
  const mb = bytes => bytes === null || bytes === undefined ? null : Math.round(bytes / 1048576);
  const of = type => pids.filter(row => row.type === type).reduce((sum, row) => sum + (sizes[String(row.id)] ?? 0), 0);
  return { fps: Math.round(fps * 10) / 10, heapMB: mb(heap), rendererMB: mb(of('renderer')), gpuMB: mb(of('GPU')) };
}

function requireNoQuiet() {
  const quiet = gitCommonPath('quiet', root);
  if (!existsSync(quiet)) return;
  const reservation = JSON.parse(readFileSync(quiet, 'utf8'));
  if (reservation.owner === process.env.CAPTURE_QUIET_OWNER && String(reservation.pid) === process.env.CAPTURE_QUIET_PID) return;
  throw new Error(`Capture waits for explicit release: ${JSON.stringify(reservation)}`);
}
function command(program, argv, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, argv, { cwd, env, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; if (program.endsWith('browser-lane.sh')) process.stdout.write(chunk); });
    child.on('error', reject);
    child.on('close', code => { if (code === 0) resolve(stdout.trim()); else reject(new Error(`${program} exited ${code}`)); });
  });
}

async function poseAt(page, pose) {
  // The look28 pose convention: heading = atan2(camera direction.x, direction.z).
  await page.evaluate(async p => {
    const api = window.__wildshard, w = api.requireWorld();
    window.__heroFreeze = (window.__heroFreeze ?? 0) + 1;
    const look = async yaw => {
      await api.pose({ x: p.x, y: p.y, z: p.z, yaw, pitch: p.pitch ?? -0.05 });
      await new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
      const direction = w.game.camera.getWorldDirection(w.game.camera.position.clone());
      return Math.atan2(direction.x, direction.z);
    };
    const first = await look(0), second = await look(Math.PI / 2);
    await look((p.heading - first) * (Math.sign(Math.sin(second - first)) || 1));
    const held = w.player.position.clone(), generation = window.__heroFreeze;
    const keepCameraPosition = () => {
      if (window.__heroFreeze !== generation) return;
      w.player.position.copy(held); w.player.velocity.set(0, 0, 0);
      requestAnimationFrame(keepCameraPosition);
    };
    keepCameraPosition();
  }, pose);
}

/** G343: stand the player in the cell the hero eye is over and wait until that shard is the entered, ready runtime with
 *  its own L0 / L1 tiles resident, then detach the camera again. The grid admits a cell by the feet's position (look48's
 *  TELEPORT entry): held above the ground until the cell's own colliders exist, then set down on them. */
async function enterOver(page, over) {
  await page.evaluate(() => { window.__heroAerialPose = null; const w = window.__wildshard.requireWorld(); w.freeCamera = false; w.player.keys.clear(); });
  const place = height => page.evaluate(async ({ stand, y }) => {
    const api = window.__wildshard, w = api.requireWorld(), live = api.shard.grid.state().live.live;
    const offset = { x: live.worldFeet.x - w.player.position.x, z: live.worldFeet.z - w.player.position.z };
    await api.pose({ x: stand.x - offset.x, z: stand.z - offset.z, ...(y === null ? {} : { y }), yaw: 0, pitch: 0 });
  }, { stand: over.stand, y: height });
  // an owned runtime crossing commits onto the neutral road first: from one entered cell, back to the roundabout, then in
  if (await page.evaluate(() => window.__wildshard.shard.grid.state().live.live.current !== null)) {
    await page.evaluate(async c => {
      const api = window.__wildshard, w = api.requireWorld(), live = api.shard.grid.state().live.live;
      await api.pose({ x: c.x - (live.worldFeet.x - w.player.position.x), z: c.z - (live.worldFeet.z - w.player.position.z), y: 0, yaw: 0, pitch: 0 });
    }, over.road);
    await page.waitForFunction(() => window.__wildshard.shard.grid.state().live.live.current === null, null, { timeout: 120000, polling: 250 });
  }
  // held high over the cell (above any of its hills) until its own colliders exist, then set down on them
  await place(300);
  await page.waitForFunction(instance => {
    const s = window.__wildshard.shard.grid.state(), l = s.live.live;
    return l.current === instance && s.inside === instance && l.gameplayReady && l.pending.length === 0 && l.residents.includes(instance);
  }, over.instance, { timeout: 240000, polling: 250 }).catch(async error => {
    // O24: say what the entry was waiting on (the desktop SQ-NE-b entry timed out here with no state)
    const state = await page.evaluate(() => {
      const s = window.__wildshard.shard.grid.state(), l = s.live.live, w = window.__wildshard.requireWorld();
      return { current: l.current, inside: s.inside, gameplayReady: l.gameplayReady, pending: l.pending, residents: l.residents, issues: l.issues,
        feet: s.feet, worldFeet: l.worldFeet, playerY: w.player.position.y, crossing: s.live.crossing };
    });
    throw new Error(`${over.instance} entry did not settle: ${JSON.stringify(state)} (${String(error)})`);
  });
  await place(null);
  // Settled: the cell is the entered runtime and no tile is in flight or queued, for three polls in a row
  const handle = await page.waitForFunction(instance => {
    const grid = window.__wildshard.shard.grid, s = grid.state(), claims = grid.residency().claims;
    const own = claims.filter(claim => claim.owner === instance);
    const count = category => own.filter(claim => claim.category === category).length;
    const tiles = { l0: count('l0'), l1: count('l1'), sim: count('sim'), rings: s.rings, ringsReady: s.ringsReady };
    // a cell streaming ring tiles has its own l0 / l1 claims; a runtime that streams itself (Driftwood's) holds its sim
    // claims and draws its own ground, so the witness records the tile counts and requires the entered runtime's sim
    const quiet = s.rings.inFlight === 0 && s.rings.queued === 0 && s.ringsReady && tiles.sim > 0 && s.live.live.current === instance;
    window.__heroSettled = quiet ? (window.__heroSettled ?? 0) + 1 : 0;
    return window.__heroSettled >= 3 ? { instance, current: s.live.live.current, inside: s.inside, feet: s.live.live.worldFeet, tiles } : false;
  }, over.instance, { timeout: 180000, polling: 500 }).catch(async error => {
    const census = await page.evaluate(() => {
      const grid = window.__wildshard.shard.grid, rows = {};
      for (const claim of grid.residency().claims) rows[`${claim.owner}/${claim.category}`] = (rows[`${claim.owner}/${claim.category}`] ?? 0) + 1;
      const s = grid.state(), w = window.__wildshard.requireWorld();
      return { current: s.live.live.current, inside: s.inside, feet: s.feet, playerY: w.player.position.y, rings: s.rings, ringsReady: s.ringsReady, claims: rows };
    });
    throw new Error(`${over.instance} tiles did not settle: ${JSON.stringify(census)} (${String(error)})`);
  });
  const witness = await handle.jsonValue();
  await page.evaluate(() => { const w = window.__wildshard.requireWorld(); w.player.keys.clear(); w.freeCamera = true; w.game.viewmodel.visible = false; });
  return witness;
}

async function capture(base) {
  requireNoQuiet();
  const report = { schema: 'engine-hero-capture/1', version: await (await fetch(new URL('version.json', base))).json(),
    device: 'iPhone 16 Pro', developer: true, renderScale: 2, canvasOnly: true, muted: true,
    clock: 'live', method: 'look28 entry/pose; camera held, no scene, lighting, quality or material changes', shots: [] };
  const save = () => writeFileSync(join(out, 'capture.json'), `${JSON.stringify(report, null, 2)}\n`);
  const memoryBrowser = await launchMemoryBrowser(['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist']);
  const {browser} = memoryBrowser;
  try {
    for (const mode of ['grid', 'driftwood-isle', 'pine-hollow']) {
      requireNoQuiet();
      const context = await browser.newContext({ ...devices['iPhone 16 Pro'] });
      try {
        await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
        await saveFixture(context, { scope: 'global', key: 'settings', merge: true,
          data: { tier: 'phone', fps: 'auto', volume: 0 } });
        await saveFixture(context, { scope: 'global', key: 'gfx', data: { dpr: '2', aa: 'auto' } });
        await context.addInitScript(() => { window.__wildshardHarness = { seed: 357, capture: null }; });
        await context.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(240000);
        page.on('pageerror', error => { errors.push(error.message); });
        page.on('console', message => { if (message.type() === 'error' && message.text().includes('[faults]')) errors.push(message.text()); });
        await page.goto(mode === 'grid' ? base : `${base}?chunk=${mode}&mute=1&skipintro=1&nolock=1&sw=0`, { waitUntil: 'domcontentloaded' });
        if (mode === 'grid') await page.locator('.ws-main-grid').click();
        await page.waitForFunction(() => Boolean(document.querySelector('#wserr .msg')?.textContent)
          || (!document.querySelector('.ws-load') && Boolean(window.__wildshard?.world?.game)));
        const failure = await page.evaluate(() => document.querySelector('#wserr .msg')?.textContent ?? null);
        if (failure) throw new Error(failure);
        await page.evaluate(() => window.__wildshard.requireWorld().hud.enterNow());
        await page.waitForTimeout(5000);
        const identity = await page.evaluate(gridFloorDocumentIdentity);
        const initial = await page.evaluate(() => {
          const w = window.__wildshard.requireWorld(), p = w.player.position;
          const direction = w.game.camera.getWorldDirection(w.game.camera.position.clone());
          return { grid: window.__wildshard.shard?.grid?.state?.() ?? null,
            pose: { x: p.x, y: p.y, z: p.z, heading: Math.atan2(direction.x, direction.z), pitch: -0.05 } };
        });
        let shots;
        if (mode === 'grid') {
          const home = initial.grid.cells.find(cell => cell.instance === initial.grid.home);
          if (!home) throw new Error('Grid home is not declared');
          const pitch = initial.grid.pitch === undefined ? 555 : initial.grid.pitch;
          if (!Number.isFinite(pitch) || pitch <= 500) throw new Error('Invalid grid pitch');
          const half = pitch / 2, x = home.cell[0] * pitch, z = home.cell[1] * pitch;
          shots = [
            { id: 'A', name: 'Road spoke', world: true, x: x + half, y: 1.8, z: z + half, heading: 0 },
            { id: 'B', name: 'Crossroads: second spoke', world: true, x: x + half, y: 1.8, z: z + half, heading: -Math.PI / 2 },
            { id: 'C', name: 'Crossroads: east boulevard', world: true, x: x + half, y: 1.8, z: z + half, heading: Math.PI / 2 },
            { id: 'D', name: 'Raised template corner', world: true, x: x + half, y: 35, z: z + half, heading: -Math.PI * 0.75, pitch: -0.25 },
            { id: 'E', name: 'Elevated template block', world: true, x: x + 350, y: 160, z: z + 350, heading: -Math.PI * 0.75, pitch: -0.42 },
            { id: 'F', name: 'Island above the junction', world: true, x: half, y: 80, z: half, heading: -Math.PI * 0.75, pitch: -0.3 },
          ];
        } else shots = [{ id: mode === 'driftwood-isle' ? 'G' : 'H', name: mode === 'driftwood-isle' ? 'Driftwood pier at spawn' : 'Pine forest road at spawn', ...initial.pose }];
        for (const shot of shots) {
          requireNoQuiet();
          const row = { id: shot.id, name: shot.name, mode, requestedPose: shot, errors: [], complete: false };
          report.shots.push(row); save();
          try {
            const pose = shot.world ? await page.evaluate(p => {
              const w = window.__wildshard.requireWorld(), live = window.__wildshard.shard.grid.state().live.live;
              return { ...p, x: p.x - (live.worldFeet.x - w.player.position.x), z: p.z - (live.worldFeet.z - w.player.position.z) };
            }, shot) : shot;
            await poseAt(page, pose); await page.waitForTimeout(3500);
            const current = await page.evaluate(gridFloorDocumentIdentity);
            if (current.token !== identity.token) throw new Error('Document changed; camera witness invalid');
            if (errors.length > 0) throw new Error(errors.join('; '));
            await page.evaluate(() => { window.__wildshard.requireWorld().game.renderer.domElement.dataset.heroCanvas = 'true'; });
            // Hide DOM overlays only. Do not remove any object or alter the actual canvas scene.
            await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas[data-hero-canvas] { visibility: visible !important; }' });
            row.frame = await page.evaluate(() => {
              const w = window.__wildshard.requireWorld();
              return { position: w.player.position.toArray(), grid: window.__wildshard.shard?.grid?.state?.().inside ?? null,
                frameCount: w.game.frameCount, renderScale: w.game.renderer.getPixelRatio(), clock: w.game.app.clock.mode };
            });
            row.file = `${shot.id}.png`;
            await page.locator('canvas[data-hero-canvas]').screenshot({ path: join(out, row.file) });
            row.complete = true;
          } catch (error) { row.errors.push(String(error)); }
          save();
          console.log(`${shot.id}: ${row.complete ? 'captured' : row.errors.join('; ')}`);
        }
      } finally { await context.close(); }
    }
  } finally { await memoryBrowser.close(); save(); }
  if (report.shots.length !== 8 || report.shots.some(shot => !shot.complete)) throw new Error('Incomplete hero set; inspect capture.json');
}

async function captureAerial(base) {
  requireNoQuiet();
  const plan = JSON.parse(await command(process.execPath,
    ['--experimental-transform-types', '--import', join(root, 'scripts/sim-node-loader.mjs'), join(root, 'scripts/main-menu-aerial-plan.mjs'), round === 'near' ? '6' : round], root));
  // --only=<pose id,…> and --sessions=<key,…> (e.g. 2048x2048) narrow a re-shoot; sessions left with no pose are skipped
  const only = flag('only', ''), keys = flag('sessions', '');
  // --enter (round 4): stand the player in the cell under the eye first (its runtime draws at full quality; the
  // lifted eye hands the cell's horizon back to the grid, G343)
  const enter = args.includes('--enter');
  if (only !== '') plan.poses = plan.poses.filter(p => only.split(',').includes(p.id));
  if (args.includes('--shipped-framing')) {
    if (round !== '6' || plan.poses.some(p => !['SQ-NE-b', 'LS-NE-b'].includes(p.id))) throw new Error('Shipped framing requires round 6, only SQ-NE-b / LS-NE-b');
    // --shift=<metres> (OB9) slides that camera along its heading toward the far rows, height, tilt and lens unchanged
    const shift = Number(flag('shift', '0'));
    for (const pose of plan.poses) Object.assign(pose, { eye: { x: 805 - shift, y: 520, z: 0 }, target: { x: -shift, y: 0, z: 0 },
      headingDegrees: 90, downDegrees: Math.atan2(520, 805) * 180 / Math.PI, fovDegrees: pose.aspect === 'square' ? 62 : 43 });
  }
  // G343 round 4: the square round's sessions over round4HeroPlan, with the near-placeholder tier on (G342)
  const far = round === 'far', variant = flag('variant', 'current');
  const near = round === 'near' || far, grid5x5 = round === '5x5', round4 = round === '4' || round === '5' || round === '6', square = round === 'square' || round4, landscape = round === 'landscape' || square || near || grid5x5;
  // Aerial: one phone context per Debug time pick. Landscape: one desktop context per resolution, desktop tier, DSF 1.
  // Square (G344): the same desktop contexts, square resolutions for the square poses and 16:9 for the landscape ones.
  const desktop = (width, height, poses) => ({ key: `${width}x${height}`, poses,
    context: { ...devices['Desktop Chrome'], viewport: { width, height }, deviceScaleFactor: 1 },
    settings: { tier: 'desktop', fps: 'auto', volume: 0 }, gfx: { dpr: 'native', aa: 'auto' } });
  // G342: from the roundabout to each of the four crossroads cells (the game's own lens), then the shipped hero (NE-b, G383)
  const centre0 = plan.road ?? plan.poses[0].target, nearPoses = [...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => ({ id: `road-${i}`, name: `Road view ${i}`,
    eye: { x: centre0.x - sx * 30, y: 22, z: centre0.z - sz * 30 }, target: { x: centre0.x + sx * 240, y: 0, z: centre0.z + sz * 240 } })),
  ...plan.poses.filter(p => p.id === 'SQ-NE-b')];
  if (far) nearPoses.splice(0, nearPoses.length, ...plan.poses);
  // --pose=<id>:<eye x,y,z>:<target x,y,z> (grid metres, the player still on the roundabout) shoots that one view instead
  const custom = flag('pose', '').split(':'), [eyeX, eyeY, eyeZ] = (custom[1] ?? '').split(',').map(Number), [toX, toY, toZ] = (custom[2] ?? '').split(',').map(Number);
  // and a fourth field <x,z> stands the player there instead (a road point: the rings and the near plan rank from the player)
  const [standX, standZ] = (custom[3] ?? '').split(',').map(Number), stand = custom.length === 4 ? { x: standX, y: 0, z: standZ } : null;
  if (custom.length >= 3) nearPoses.splice(0, nearPoses.length, { id: custom[0], name: custom[0], eye: { x: eyeX, y: eyeY, z: eyeZ }, target: { x: toX, y: toY, z: toZ } });
  const sessions = (grid5x5
    ? [{ key: 'phone-1440', poses: plan.poses, context: { ...devices['Desktop Chrome'], viewport: { width: 720, height: 720 }, deviceScaleFactor: 2 },
      settings: { tier: 'phone', fps: 'auto', volume: 0 }, gfx: { dpr: '2', aa: 'auto' } }]
    : near
    ? ['B'].flatMap(mode => [
      { key: `${mode}-iphone`, poses: nearPoses, context: { ...devices['iPhone 16 Pro'] },
        settings: { tier: 'phone', fps: 'auto', volume: 0 }, gfx: { dpr: '2', aa: 'auto' } },
      { key: `${mode}-desktop`, poses: nearPoses, context: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
        settings: { tier: 'desktop', fps: 'auto', volume: 0 }, gfx: { dpr: 'native', aa: 'auto' } }])
    : square
    ? [[2048, 2048, 'square'], [1440, 1440, 'square'], [2560, 1440, 'landscape'], [1920, 1080, 'landscape']]
      .map(([width, height, aspect]) => desktop(width, height, plan.poses.filter(p => p.aspect === aspect)))
    : landscape
      ? [[2560, 1440], [1920, 1080]].map(([width, height]) => desktop(width, height, plan.poses))
      : ['golden', 'midday', 'sunset'].map(timePick => ({ key: timePick, poses: plan.poses.filter(p => p.timePick === timePick),
        context: { ...devices['iPhone 16 Pro'] },
        settings: { tier: 'phone', fps: 'auto', volume: 0, time: timePick }, gfx: { dpr: '2', aa: 'auto' } })))
    .filter(session => session.poses.length > 0 && (keys === '' || keys.split(',').includes(session.key)));
  const expected = landscape ? sessions.reduce((sum, session) => sum + session.poses.length, 0) : 15;
  const report = { schema: 'engine-hero-capture/1', version: await (await fetch(new URL('version.json', base))).json(),
    round, device: grid5x5 ? 'Desktop Chrome 720 × 720 CSS, DSF 2 (1440 × 1440 canvas), phone tier, shipped cell tiers' : landscape ? `Desktop Chrome (${sessions.map(session => session.key.replace('x', '×')).join(', ')}, DSF 1)` : 'iPhone 16 Pro', developer: true,
    renderScale: landscape && !grid5x5 ? 1 : 2, tier: landscape && !grid5x5 ? 'desktop' : 'phone', canvasOnly: true, muted: true,
    clock: 'live', camera: `Existing freeCamera flag; fixed detached camera in late phase; player remains on the road${square ? '; per-pose capture-time vertical FOV (fovDegrees) on that camera only, CAMERA_FOV unchanged' : ''}`,
    noViewmodel: true, junction: plan.junction, surrounding: plan.surrounding,
    roadLighting: 'Shipping ROAD_SKY is fixed low dawn; requested Debug time picks do not rewrite that look', shots: [] };
  const save = () => writeFileSync(join(out, 'capture.json'), `${JSON.stringify(report, null, 2)}\n`);
  const memoryBrowser = await launchMemoryBrowser(['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info']);
  const {browser} = memoryBrowser;
  try {
    for (const session of sessions) {
      requireNoQuiet();
      const context = await browser.newContext(session.context);
      try {
        await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
        await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: session.settings });
        await saveFixture(context, { scope: 'global', key: 'gfx', data: session.gfx });
        await context.addInitScript(() => { window.__wildshardHarness = { seed: 357, capture: null }; });
        await context.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
        const page = await context.newPage(), errors = [], consoleErrors = [];
        page.setDefaultTimeout(180000);
        page.on('pageerror', error => { errors.push(error.message); });
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.locator('.ws-main-grid').click();
        await page.waitForFunction(() => Boolean(document.querySelector('#wserr .msg')?.textContent)
          || (!document.querySelector('.ws-load') && Boolean(window.__wildshard?.world?.game)));
        const failure = await page.evaluate(() => document.querySelector('#wserr .msg')?.textContent ?? null);
        if (failure) throw new Error(failure);
        await page.evaluate(() => window.__wildshard.requireWorld().hud.enterNow());
        await page.waitForTimeout(8000);
        const identity = await page.evaluate(gridFloorDocumentIdentity);
        const centre = near && stand !== null ? stand : centre0;
        await page.evaluate(async p => {
          const api = window.__wildshard, w = api.requireWorld(), live = api.shard.grid.state().live.live;
          const offset = { x: live.worldFeet.x - w.player.position.x, z: live.worldFeet.z - w.player.position.z };
          await api.pose({ x: p.x - offset.x, z: p.z - offset.z, y: 0, yaw: 0, pitch: 0 });
        }, centre);
        await page.waitForTimeout(5000);
        await page.evaluate(() => {
          const w = window.__wildshard.requireWorld();
          w.freeCamera = true;
          w.game.viewmodel.visible = false;
          w.player.keys.clear();
          w.game.renderer.domElement.dataset.heroCanvas = 'true';
          // This is the existing free-camera gate, not a player teleported around
          // the sky. Grid origin shifts are resolved anew on every real frame.
          w.game.onLate(() => {
            const p = window.__heroAerialPose;
            if (!p) return;
            const live = window.__wildshard.shard.grid.state().live.live;
            const origin = window.__wildshard.shard.grid.state().live.renderOrigin, dx = live.worldFeet.x - w.player.position.x - origin.x, dz = live.worldFeet.z - w.player.position.z - origin.z;
            w.game.camera.position.set(p.eye.x - dx, p.eye.y, p.eye.z - dz);
            w.game.camera.lookAt(p.target.x - dx, p.target.y, p.target.z - dz);
            // G344: a pose's own lens, held each late phase over whatever lens the road or a cell wrote this frame.
            if (typeof p.fovDegrees === 'number' && Math.abs(w.game.camera.fov - p.fovDegrees) > 1e-4) {
              w.game.camera.fov = p.fovDegrees; w.game.camera.updateProjectionMatrix(); w.sky.csm.updateFrustums();
            }
            // G536: the whole 5 × 5 lies past the game's far plane; this shot's own, on the capture camera only
            if (typeof p.farMetres === 'number' && w.game.camera.far < p.farMetres) {
              w.game.camera.far = p.farMetres; w.game.camera.updateProjectionMatrix(); w.sky.csm.updateFrustums();
            }
            w.game.camera.updateMatrixWorld(true);
            w.game.viewmodel.visible = false;
          }, 'harness.hero-aerial');
        });
        await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas[data-hero-canvas] { visibility: visible !important; }' });
        let entered = null;
        for (const shot of session.poses) {
          requireNoQuiet();
          const row = { ...shot, session: session.key, requestedPose: shot, errors: [], complete: false };
          report.shots.push(row); save();
          try {
            // G343: stand the player in the cell the eye is over, so that shard draws its own runtime (not a placeholder)
            // the near round never enters: an entry from the air does not hold (the phone tier timed out; on desktop, O24, the
            // set-down player is recovered to the road before the cell's tiles settle), and the near round shoots shipped tiers,
            // so the hero view's cell draws its near placeholder on both tiers, and the label's tier readout says so
            const enterHere = enter && shot.over !== undefined && !near;
            if (enterHere && shot.over.instance !== entered?.instance) {
              entered = await enterOver(page, { ...shot.over, road: centre0 });
              console.log(`entered ${shot.over.slug} for ${session.key}: ${JSON.stringify(entered.tiles)}`);
            }
            if (enterHere) row.entered = entered;
            await page.evaluate(p => { window.__heroAerialPose = p; }, shot);
            await page.waitForTimeout(3500);
            const current = await page.evaluate(gridFloorDocumentIdentity);
            if (current.token !== identity.token) throw new Error('Document changed; aerial camera witness invalid');
            if (errors.length > 0) throw new Error(errors.join('; '));
            row.frame = await page.evaluate(() => {
              const w = window.__wildshard.requireWorld(), grid = window.__wildshard.shard.grid.state();
              const live = grid.live.live, dx = live.worldFeet.x - w.player.position.x - grid.live.renderOrigin.x, dz = live.worldFeet.z - w.player.position.z - grid.live.renderOrigin.z;
              const p = w.game.camera.position, direction = w.game.camera.getWorldDirection(p.clone());
              return { cameraWorld: [p.x + dx, p.y, p.z + dz], direction: direction.toArray(), playerWorld: live.worldFeet,
                freeCamera: w.freeCamera, viewmodelVisible: w.game.viewmodel.visible, cells: grid.cells, gridPitch: grid.pitch ?? 555, near: grid.near,
                renderScale: w.game.renderer.getPixelRatio(), frameCount: w.game.frameCount, fov: w.game.camera.fov, aspect: w.game.camera.aspect,
                dayClock: w.sky.dayNight?.snapshot() ?? null, clock: w.game.app.clock.mode };
            });
            if (!row.frame.freeCamera || row.frame.viewmodelVisible) throw new Error('Detached-camera / no-viewmodel witness failed');
            if (enterHere && row.frame.cells.find(cell => cell.instance === shot.over.instance)?.shows !== 'playing') throw new Error(`${shot.over.instance} is not the playing cell under the eye`);
            if (Math.hypot(...row.frame.cameraWorld.map((v, i) => v - [shot.eye.x, shot.eye.y, shot.eye.z][i])) > 0.01) throw new Error('Actual aerial camera differs from requested pose');
            if (typeof shot.fovDegrees === 'number' && Math.abs(row.frame.fov - shot.fovDegrees) > 0.01) throw new Error(`Camera FOV ${row.frame.fov} is not the requested ${shot.fovDegrees}`);
            // a road view is named for the shard it looks at (Jake: every neighbour obvious, e.g. A-road-nalati-iphone)
            const facing = shot.id.startsWith('road-') ? row.frame.cells.find(cell => Math.abs(cell.cell[0] * row.frame.gridPitch - shot.target.x) < row.frame.gridPitch / 2 && Math.abs(cell.cell[1] * row.frame.gridPitch - shot.target.z) < row.frame.gridPitch / 2) : undefined;
            const name = facing === undefined ? shot.id : `road-${facing.slug.replace(/^_/u, '').split('-')[0]}`;
            row.file = far ? `${variant}-${shot.id}-${session.key.slice(2)}.png` : near ? `${session.key.slice(0, 1)}-${name}-${session.key.slice(2)}.png` : landscape ? `${shot.id}-${session.key}.png` : `${shot.id}.png`;
            if (far) row.metrics = { variant, ...(await farMetrics(browser, page)) };
            await page.locator('canvas[data-hero-canvas]').screenshot({ path: join(out, row.file) });
            row.consoleErrors = [...consoleErrors]; row.complete = true;
          } catch (error) { row.errors.push(String(error)); }
          save(); console.log(`${shot.id} ${session.key}: ${row.complete ? 'captured' : row.errors.join('; ')}`);
        }
      } finally { await context.close(); }
    }
  } finally { await memoryBrowser.close(); save(); }
  report.shots.sort((a, b) => plan.poses.findIndex(p => p.id === a.id) - plan.poses.findIndex(p => p.id === b.id)); save();
  if (report.shots.length !== expected || report.shots.some(shot => !shot.complete)) throw new Error('Incomplete aerial set; inspect capture.json');
}

mkdirSync(out, { recursive: true });
if (args.includes('--worker')) {
  if (process.env.HERO_CAPTURE_LANE !== '1') throw new Error('Run through this command’s browser-lane launcher');
  await (round === 'aerial' || round === 'landscape' || round === 'square' || round === 'near' || round === '4' || round === '5' || round === '6' || round === '5x5' || round === 'far' ? captureAerial(flag('base', '')) : capture(flag('base', '')));
} else {
  requireNoQuiet();
  const scratch = join(out, 'build'); mkdirSync(scratch, { recursive: true });
  let base;
  try {
    const served = flag('url', '');
    base = served !== '' ? served : (await command(join(root, 'scripts/serve-build.sh'), [...(args.includes('--tree') ? [] : flag('rev', '') !== '' ? ['--rev', flag('rev', '')] : ['--head']), '--name', 'main-menu-hero', '--hours', '1'], scratch,
      { ...process.env, SERVE_OWNER: serveOwner })).split('\n').at(-1);
    requireNoQuiet();
    await command(join(root, 'scripts/browser-lane.sh'), ['--max', '20', process.execPath, script, '--worker', `--round=${round}`, `--base=${base}`, `--out=${out}`,
      ...args.filter(value => /^--(?:only=|sessions=|pose=|enter$|shipped-framing$|shift=|variant=)/u.test(value))], root,
      { ...process.env, HERO_CAPTURE_LANE: '1' });
    console.log(`Canvas candidates and pinned capture.json: ${out}`);
  } finally {
    if (base && flag('url', '') === '') await command(join(root, 'scripts/serve-build.sh'), ['stop', new URL(base).port], root, { ...process.env, SERVE_OWNER: serveOwner });
  }
}
