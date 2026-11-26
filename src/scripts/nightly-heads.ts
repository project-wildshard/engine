#!/usr/bin/env node
// An already-built checkout, cold worker products, actual phone UI, no shard source fetch.
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {join, resolve as resolvePath} from 'node:path';
import {chromium, webkit, type Browser} from "./browser-playwright.mjs";
import {bootCase} from './parity/boot-smoke.mjs';
import {captureNightlyBootFrame, nightlyDrawSamples, NIGHTLY_FRAME_LIMIT as HOVER_FRAMES, NIGHTLY_WALL_MS as HOVER_CEILING_MS} from './parity/nightly-frames.mjs';
import {sweepExplorer} from './parity/explorer-smoke.mjs';
import {serve} from './parity/serve.mjs';
import {levelDownloadFixtures, saveFixture} from './debug-settings.mjs';
import {coldGridRows, headGroups, plan, read, requireBuild, type HeadResult, type HeadsReport, type PacksBookRows} from './nightly-model.ts';
import type {CookIndex} from '../cook/game/cookWorker.ts';
import type {StandaloneCatalogue} from '@wildshard/format/standaloneCatalogue';
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';

await import('./bake-loader.mjs');
const {BOOST_TAP_MS} = await import('../client/engine/ui/hoverBoost.ts');
const {folderStore} = await import('../cook/game/packStore.ts');
const {objectHeaders, DEFAULT_LIMITS} = await import('../cook/game/cookWorker.ts');
const {addStoredShards, nightlyHeadCatalogue} = await import('./app-build/catalogue.ts');
const {bareSlug} = await import('../shared/game/grid/catalogueSlot.ts');
const {packsBookPath} = await import('../shared/game/shardfile/spawnManifest.ts');
const [browserName, groupText, directory = 'tmp/nightly/reports', only, fault = 'none'] = process.argv.slice(2);
if (browserName !== 'chromium' && browserName !== 'webkit') throw new Error('Choose chromium or webkit');
if (fault !== 'none' && (fault !== 'hover-control' || only === undefined)) throw new Error('A hover-control fault requires a single diagnostic head');
const expected = plan(), selected = headGroups(expected.heads, browserName)[Number(groupText)];
if (selected === undefined) throw new Error('Invalid nightly partition');
if (only !== undefined && !selected.some(row => row.slug === only)) throw new Error('Head outside partition');
const out = resolvePath(directory), root = process.cwd(), dist = join(root, 'dist');
mkdirSync(out, {recursive: true});
const report: HeadsReport & {diagnosticFault: string} = {...expected, kind: 'heads', browser: browserName, group: Number(groupText), diagnosticFault: fault, results: []};
const receipt = join(out, `heads-${browserName}-${groupText}.json`);
const checkpoint = () => {writeFileSync(`${receipt}.next`, `${JSON.stringify(report, null, 2)}\n`); renameSync(`${receipt}.next`, receipt);};
checkpoint();
const {build} = read(join(dist, 'version.json')) as {build: string};
requireBuild(build, expected);
const bookFile = join(dist, packsBookPath(build)), originalBook = readFileSync(bookFile, 'utf8');
const live = read('test/pins/catalogue.json') as StandaloneCatalogue;
const {catalogue: reviewed} = read('test/pins/staging.json') as {catalogue: StandaloneCatalogue};
const catalogueFile = join(dist, 'catalogue.json'), originalCatalogue = readFileSync(catalogueFile);
const originalHTML = readFileSync(join(dist, 'index.html'), 'utf8');
const work = mkdtempSync(join(out, '.heads-'));
// TC22 (opus-nightly2): Chromium's own stderr names a GPU-process exit (its exit code, a watchdog hang, a lost context),
// which the page only sees as wiped canvases. The workflow runs this under DEBUG=pw:browser, so Playwright relays each
// browser stderr line through ours: keep the head's lines for its evidence, and leave page console lines out of the log.
const browserLines: string[] = [], writeStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
  const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
  if (!text.includes('pw:browser')) return Reflect.apply(writeStderr, process.stderr, [chunk, ...rest]) === true;
  let shown = '';
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    browserLines.push(line.slice(0, 500));
    if (!line.includes(':CONSOLE')) shown += `${line}\n`;
  }
  if (browserLines.length > 4000) browserLines.splice(0, 2000);
  return shown === '' ? true : writeStderr(shown);
};
const GPU_LINE = /gpu|watchdog|hang|crash|exited|exit_code|context_lost|lost context|metal|angle|out of memory|oom/iu;
let preview: Awaited<ReturnType<typeof serve>> | undefined;
try {
  preview = await serve(root, '', true, { errorReports: true });
  for (const head of selected.filter(row => only === undefined || row.slug === only)) {
    const result: HeadResult = {slug: head.slug, hash: head.hash, phases: []};
    browserLines.length = 0;
    report.results.push(result); checkpoint();
    const phase = async (name: string, run: () => unknown): Promise<boolean> => {
      const started = Date.now();
      try {const detail = await run(); result.phases.push({name, ok: true, ms: Date.now() - started, detail}); checkpoint(); return true;}
      catch (error) {result.phases.push({name, ok: false, ms: Date.now() - started, error: (error instanceof Error ? error.stack ?? String(error) : String(error)).slice(0, 4000)}); checkpoint(); return false;}
    };
    const cooked = join(work, head.slug), evidence = join(work, `${head.slug}-evidence`);
    mkdirSync(evidence);
    let packs: ReturnType<typeof createServer> | undefined, browser: Browser | undefined;
    const fetched = new Set<string>();
    const retirementFailed = (error: unknown): void => {
      const boot = result.phases.find(row => row.name === 'boot');
      const message = `Browser/store retirement: ${String(error).slice(0, 1000)}`;
      if (boot === undefined) result.phases.push({name: 'boot', ok: false, error: message});
      else {boot.ok = false; boot.error = `${boot.error ?? ''}\n${message}`.trim();}
      checkpoint();
    };
    try {
      if (!await phase('cook', () => {
        // Use the same production worker limit as the Ring 2 CLI, including cold phone ASTC encodes.
        const timeout = DEFAULT_LIMITS.seconds * 1000;
        execFileSync(process.execPath, ['src/scripts/ring-cook.mjs', '--ring2', `--only=${head.slug}`, `--out=${cooked}`, `--build=${build}`, `--timeout-ms=${timeout}`],
          {stdio: 'inherit', timeout: timeout + 30_000});
        const cookedReceipt = (read(join(cooked, 'receipt.json')) as {indexes: CookIndex[]});
        const index = cookedReceipt.indexes[0];
        if (index?.hash !== head.hash || index.slug !== head.slug || index.build !== build || index.keys.length === 0) throw new Error('Wrong or empty cooked product');
        return {build, objects: index.keys.length, seconds: index.seconds, proof: index.proof};
      })) continue;
      const store = folderStore(join(cooked, 'store'));
      const index = (read(join(cooked, 'receipt.json')) as {indexes: CookIndex[]}).indexes[0];
      if (index === undefined) throw new Error('Missing cooked index');
      packs = createServer((request, response) => {
        const key = new URL(request.url ?? '/', 'http://127.0.0.1').pathname.slice(1);
        void store.get(key).then(bytes => {
          if (bytes === undefined) {response.writeHead(404, {'access-control-allow-origin': '*'}).end(); return undefined;}
          fetched.add(key); const headers = objectHeaders(key);
          response.writeHead(200, {'content-type': headers.type, 'cache-control': headers.cache, 'access-control-allow-origin': '*',
            ...(headers.encoding === undefined ? {} : {'content-encoding': headers.encoding})}).end(bytes); return undefined;
        }).catch(() => response.writeHead(500, {'access-control-allow-origin': '*'}).end());
      });
      const packServer = packs;
      await new Promise<void>((resolve, reject) => {packServer.once('error', reject); packServer.listen(0, '127.0.0.1', resolve);});
      const address = packs.address();
      if (address === null || typeof address === 'string') throw new Error('No pack origin');
      // The production installer deliberately preserves a build's own products. Remove
      // this head from that generated bank first: otherwise it would silently skip
      // the cold cook and boot the build's pre-existing pack instead (P2).
      const expression = /(<script type="application\/json" id="boot-module-files">)([^<]+)(<\/script>)/u;
      const bankText = expression.exec(originalHTML)?.[2];
      if (bankText === undefined) throw new Error('Missing build bank');
      const bank = JSON.parse(bankText) as {spawnManifests: {client: Record<string, unknown>}; entryPrograms?: Record<string, unknown>};
      for (const slug of Object.keys(bank.spawnManifests.client)) if (bareSlug(slug) === bareSlug(head.slug)) delete bank.spawnManifests.client[slug];
      if (bank.entryPrograms !== undefined) for (const slug of Object.keys(bank.entryPrograms)) if (bareSlug(slug) === bareSlug(head.slug)) delete bank.entryPrograms[slug];
      // Detach the whole-level row too. An authored `_<slug>` key wins
      // exact lookup over a newly installed canonical `<slug>` cook row,
      // otherwise sending an old manifest URL to the new cold pack store.
      const book = JSON.parse(originalBook) as {client: Record<string, unknown>};
      for (const slug of Object.keys(book.client)) if (bareSlug(slug) === bareSlug(head.slug)) delete book.client[slug];
      writeFileSync(bookFile, JSON.stringify(book));
      writeFileSync(join(dist, 'index.html'), originalHTML.replace(expression, (_, before, _body, after) => `${before}${JSON.stringify(bank).replaceAll('<', String.raw`\u003c`)}${after}`));
      writeFileSync(catalogueFile, originalCatalogue);
      const added = await addStoredShards(dist, [head], store,
        hash => Promise.resolve(readFileSync(join(process.env.WILDSHARD_PIN_CACHE ?? join(homedir(), '.cache/wildshard/pins'), `${hash}.tar`))),
        {base: `http://127.0.0.1:${address.port}`, shards: []}, nightlyHeadCatalogue(live, reviewed, head));
      if (added.length !== 1 || added[0] !== head.slug) throw new Error('Cold cook was not attached');
      // CP22: the head boots its cell on the grid path, whose rows must name the cold cook too (row 144)
      writeFileSync(bookFile, JSON.stringify(coldGridRows(JSON.parse(readFileSync(bookFile, 'utf8')) as PacksBookRows, head.slug, (left, right) => bareSlug(left) === bareSlug(right))));
      const titlesText = /<script type="application\/json" id="ws-title-rows">([^<]*)<\/script>/u.exec(readFileSync(join(dist, 'index.html'), 'utf8'))?.[1];
      if (titlesText === undefined) throw new Error('No title routes');
      const title = (JSON.parse(titlesText) as {slug: string; shardSelect?: boolean}[]).find(row => bareSlug(row.slug) === bareSlug(head.slug));
      if (title === undefined) throw new Error(`No title route for ${head.slug}`);
      const route = title.slug, mode = title.shardSelect === false ? 'arrival' : 'standalone';
      browser = browserName === 'webkit' ? await webkit.launch({headless: true}) : await chromium.launch({headless: true,
        args: [...KEYCHAIN_ARGS, `--use-angle=${process.platform === 'darwin' ? 'metal' : 'swiftshader'}`, '--ignore-gpu-blocklist', '--mute-audio']});
      const activeBrowser = browser, url = preview.url;
      const bootEvidence = join(evidence, 'boot'), explorerEvidence = join(evidence, 'explorer');
      mkdirSync(bootEvidence); mkdirSync(explorerEvidence);
      await phase('boot', async () => {
        const boot = await bootCase(activeBrowser, url, mode, bootEvidence, route, true, async page => {
          await phase('hover', async () => {
            // J352: these product boots are inside a zone, whose cruise is
            // 14 m/s. Road cruise is exercised by the grid tests.
            const expectedCap = 14;
            const actualCap = await page.evaluate(() => {
              const player = window.__wildshard?.world?.player;
              if (player === undefined) throw new Error('Hover metadata has no entered player');
              return player.hoverSpeedLimit?.() ?? 14;
            });
            if (actualCap !== expectedCap) throw new Error(`${head.slug}: admitted hover cap ${actualCap} differs from ${expectedCap}`);
            const observeHover = () => page.evaluate(() => {
              const predictorField = (link: object, name: string): unknown => {
                const predictor: unknown = Reflect.get(link, 'predictor');
                return typeof predictor === 'object' && predictor !== null ? Reflect.get(predictor, name) : null;
              };
              const world = window.__wildshard?.world;
              if (world === undefined) return null;
              const board = world.weapons.tools.find(tool => tool.id === 'tool.hoverboard');
              return {hover: world.player.hover, boost: world.player.hoverBoost, blend: world.player.hoverBlend,
                equipmentEnabled: world.weapons.enabled, owned: world.weapons.has('tool.hoverboard'),
                toolInstalled: board !== undefined, toolEnabled: board?.enabled ?? null,
                modelVisible: board !== undefined && 'model' in board && typeof board.model === 'object' && board.model !== null && 'visible' in board.model ? board.model.visible : null,
                inputAllowed: world.game.app.input.allowed('hover'), inputContext: world.game.app.input.top,
                frame: world.game.frameCount, paused: world.game.app.clock.paused, linked: world.player.link !== null,
                // FS30e: the seat and the predictor name a tap the server refused or never saw
                appState: world.game.app.state, carried: world.player.carried,
                seat: world.player.link === null ? null : {joined: Reflect.get(world.player.link, 'joined') as unknown,
                  corrections: predictorField(world.player.link, 'corrections'), full: predictorField(world.player.link, 'full')},
                recent: world.game.app.input.recent.filter(row => row.action === 'hover')};
            });
            const before = await observeHover();
            const control = page.locator('.ws-touch-hover');
            // Observe browser dispatch and the real input boundary without replacing
            // a service or changing the player's state. Retain this on failure too.
            const probe = await page.evaluateHandle(() => {
              const events: object[] = [], controller = new AbortController();
              const observe = (event: Event) => {
                if (events.length >= 40) return;
                const target = event.target;
                const world = window.__wildshard?.world;
                events.push({type: event.type, at: performance.now(), trusted: event.isTrusted,
                  target: target instanceof Element ? target.className : null,
                  hover: world?.player.hover, boost: world?.player.hoverBoost,
                  recent: world?.game.app.input.recent.filter(row => row.action === 'hover')});
              };
              for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'click', 'dblclick']) {
                document.addEventListener(type, observe, {capture: true, passive: true, signal: controller.signal});
              }
              return {events, controller};
            });
            let action = 'equipment readiness';
            try {
            // Live world frames can precede its asynchronous equipment entry.
            // Wait for the real board's input owner before sending a single tap.
            await page.waitForFunction(() => {
              const world = window.__wildshard?.world;
              return world?.weapons.enabled === true && world.weapons.has('tool.hoverboard') &&
                world.game.app.input.allowed('hover') && world.weapons.tools.some(tool => tool.id === 'tool.hoverboard' && tool.enabled);
            }, undefined, {timeout: 10000});
            action = 'mount';
            // Manual negative control only: the real page loses its actual
            // input control. The ordinary tap/oracle must catch this regression.
            if (fault === 'hover-control') await control.evaluate(button => { button.remove(); });
            await control.tap({timeout: HOVER_CEILING_MS});
            // FS30 (opus-drift6): a runner that draws ~2 frames a second spent its whole 10 s wall-clock wait on 22 frames
            // (run 44863911819), while the board's blend needs ~10 frames past the tap at any rate (local Chromium at 20x CPU
            // throttle and WebKit mount Driftwood r8 on a real tap). Wait on the page's own frames: HOVER_FRAMES of them past
            // the tap, under a wall-clock ceiling for a page that stops drawing.
            const tappedFrame = await page.evaluate(() => window.__wildshard?.world?.game.frameCount ?? 0);
            await page.waitForFunction(({from, frames}) => {
              const world = window.__wildshard?.world;
              if (world === undefined) return false;
              // FS30e: each change of the board, with the seat's corrections, for a mount that flicks on and drops
              const trace = (window as unknown as {__wsHoverTrace?: unknown[][]}).__wsHoverTrace ??= [];
              const predictor: unknown = world.player.link === null ? null : Reflect.get(world.player.link, 'predictor');
              const corrections: unknown = typeof predictor === 'object' && predictor !== null ? Reflect.get(predictor, 'corrections') : null;
              const last = trace.at(-1);
              if (trace.length < 40 && (last === undefined || last[1] !== world.player.hover || last[2] !== corrections)) trace.push([world.game.frameCount, world.player.hover, corrections]);
              if (world.game.frameCount - from > frames) throw new Error(`no mount within ${frames} frames of the tap`);
              return world.player.hover && world.player.hoverBlend > 0.5 &&
                world.weapons.tools.some(tool => tool.id === 'tool.hoverboard' && tool.enabled && 'model' in tool && tool.model instanceof Object && 'visible' in tool.model && tool.model.visible === true);
            }, {from: tappedFrame, frames: HOVER_FRAMES}, {timeout: HOVER_CEILING_MS});
            action = 'unmount';
            // The gesture gap is wall time. Both witness checks still require
            // real frames, but a slow renderer need not service a cooldown probe.
            await delay(BOOST_TAP_MS + 1);
            const unmountFrame = await page.evaluate(() => window.__wildshard?.world?.game.frameCount ?? 0);
            await control.tap({timeout: HOVER_CEILING_MS});
            await page.waitForFunction(({from, frames}) => {
              const world = window.__wildshard?.world;
              if (world === undefined) return false;
              if (world.game.frameCount - from > frames) throw new Error(`no unmount within ${frames} frames of the tap`);
              return !world.player.hover;
            }, {from: unmountFrame, frames: HOVER_FRAMES}, {timeout: HOVER_CEILING_MS});
            } catch (error) {
              const after = await observeHover().catch(() => null);
              throw new Error(`${head.slug}: hover ${action} failed: ${String(error)}; ${JSON.stringify({before, after})}`, {cause: error});
            } finally {
              const events = await probe.evaluate(value => {value.controller.abort(); return value.events;});
              const trace = await page.evaluate(() => (window as unknown as {__wsHoverTrace?: unknown[][]}).__wsHoverTrace ?? []).catch(() => null);
              writeFileSync(join(evidence, 'hover.json'), JSON.stringify({action, before, after: await observeHover(), events, trace}, null, 2));
              await probe.dispose();
            }
            return {mounted: true, unmounted: true, input: 'real touch', actualCap, expectedCap};
          });
        }, async context => {
          // FS30e diagnostics only: emulate the slow hosted renderer (a nightly Chromium head ran at ~2.7 fps)
          const throttle = Number(process.env.NIGHTLY_CPU_THROTTLE ?? '1');
          if (browserName === 'chromium' && throttle > 1) context.on('page', page => {
            void context.newCDPSession(page).then(session => session.send('Emulation.setCPUThrottlingRate', {rate: throttle}));
          });
          for (const fixture of levelDownloadFixtures('packs')) await saveFixture(context, fixture);
          if (mode === 'arrival') await saveFixture(context, {scope: 'session', key: 'travel.handoff', data: {
            v: 1, from: null, to: route, mode: 'enter', arrive: null, carry: [], at: Date.now(),
          }});
        }, {
          allowSlowBootReport: true,
          ...(browserName === 'chromium' && process.platform === 'linux' ? {capture: captureNightlyBootFrame} : {}),
          onEnter: async page => {
            await phase('draw', async () => {
              // Observe completed engine frames, including shadow/post/held passes.
              // Software-hosted timing and the advisory 150 threshold never gate.
              const samples = await nightlyDrawSamples(page);
              return {reportOnly: true, frames: samples.length, maxCalls: Math.max(...samples), advisory: 150, samples};
            });
          },
        });
        const clientKeys = new Set(index.keys.filter(key => !key.startsWith('assets/spawn/server/')));
        const used = [...fetched].filter(key => clientKeys.has(key));
        if (!used.some(key => /^assets\/spawn\/parts\/[a-f0-9]+\.pack\.br$/u.test(key))) throw new Error('No client part from this cold cook reached gameplay');
        if ([...fetched].some(key => !index.keys.includes(key))) throw new Error('Page fetched an object outside this head cook');
        return {route, entry: mode, gameplayFrames: boot.frame, ms: boot.elapsedMs, stalls: 'stalls' in boot ? boot.stalls : null, fetched: used};
      });
      await phase('explorer', async () => {await sweepExplorer(activeBrowser, url, route, explorerEvidence, true); return {route, rendered: true};});
    } catch (error) {
      if (!result.phases.some(row => row.name === 'boot')) result.phases.push({name: 'boot', ok: false, error: (error instanceof Error ? error.stack ?? String(error) : String(error)).slice(0, 4000)});
      checkpoint();
    } finally {
      await browser?.close().catch(retirementFailed);
      if (packs !== undefined) {
        const server = packs; server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {server.close(error => {if (error === undefined) resolve(); else reject(error);});}).catch(retirementFailed);
      }
      writeFileSync(join(evidence, 'browser-log.json'), JSON.stringify({relayed: process.env.DEBUG?.includes('pw:browser') === true,
        gpu: browserLines.filter(line => !line.includes(':CONSOLE') && GPU_LINE.test(line)).slice(-200),
        tail: browserLines.filter(line => !line.includes(':CONSOLE')).slice(-80)}, null, 2));
      if (result.phases.some(row => !row.ok)) cpSync(evidence, join(out, 'failures', `${browserName}-${groupText}-${head.slug}`),
        {recursive: true, filter: path => statSync(path).isDirectory() || path.endsWith('.json')});
      // Own generated outputs only. Reports are checkpointed separately from large packs/captures.
      rmSync(cooked, {recursive: true, force: true}); rmSync(evidence, {recursive: true, force: true});
    }
  }
} finally {
  preview?.close();
  writeFileSync(join(dist, 'index.html'), originalHTML);
  writeFileSync(bookFile, originalBook);
  writeFileSync(catalogueFile, originalCatalogue);
  rmSync(work, {recursive: true, force: true});
  checkpoint();
}
if (report.results.some(row => row.phases.length !== 5 || row.phases.some(phase => !phase.ok))) process.exitCode = 1;
