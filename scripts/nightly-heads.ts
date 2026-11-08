#!/usr/bin/env node
// An already-built checkout, cold worker products, actual phone UI, no shard source fetch.
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import {join, resolve as resolvePath} from 'node:path';
import {chromium, webkit, type Browser} from 'playwright';
import {bootCase} from './parity/boot-smoke.mjs';
import {sweepExplorer} from './parity/explorer-smoke.mjs';
import {serve} from './parity/serve.mjs';
import {levelDownloadFixtures, saveFixture} from './debug-settings.mjs';
import {partition, plan, read, requireBuild, type HeadResult, type HeadsReport} from './nightly-model.ts';
import type {CookIndex} from '../src/cook/game/cookWorker.ts';
import type {StandaloneCatalogue} from '@wildshard/format/standaloneCatalogue';

await import('./bake-loader.mjs');
const {folderStore} = await import('../src/cook/game/packStore.ts');
const {objectHeaders} = await import('../src/cook/game/cookWorker.ts');
const {addStoredShards} = await import('./app-build/catalogue.ts');
const {bareSlug} = await import('../src/shared/game/grid/catalogueSlot.ts');
const [browserName, groupText, directory = 'tmp/nightly/reports', only] = process.argv.slice(2);
if (browserName !== 'chromium' && browserName !== 'webkit') throw new Error('Choose chromium or webkit');
const expected = plan(), selected = partition(expected.heads, Number(groupText));
if (only !== undefined && !selected.some(row => row.slug === only)) throw new Error('Head outside partition');
const out = resolvePath(directory), root = process.cwd(), dist = join(root, 'dist');
mkdirSync(out, {recursive: true});
const report: HeadsReport = {...expected, kind: 'heads', browser: browserName, group: Number(groupText), results: []};
const receipt = join(out, `heads-${browserName}-${groupText}.json`);
const checkpoint = () => {writeFileSync(`${receipt}.next`, `${JSON.stringify(report, null, 2)}\n`); renameSync(`${receipt}.next`, receipt);};
checkpoint();
const {build} = read(join(dist, 'version.json')) as {build: string};
requireBuild(build, expected);
const live = read('test/pins/catalogue.json') as StandaloneCatalogue;
const originalHTML = readFileSync(join(dist, 'index.html'), 'utf8');
const work = mkdtempSync(join(out, '.heads-'));
let preview: Awaited<ReturnType<typeof serve>> | undefined;
try {
  preview = await serve(root, '', true);
  for (const head of selected.filter(row => only === undefined || row.slug === only)) {
    const result: HeadResult = {slug: head.slug, hash: head.hash, phases: []};
    report.results.push(result); checkpoint();
    const phase = async (name: string, run: () => unknown): Promise<boolean> => {
      const started = Date.now();
      try {const detail = await run(); result.phases.push({name, ok: true, ms: Date.now() - started, detail}); checkpoint(); return true;}
      catch (error) {result.phases.push({name, ok: false, ms: Date.now() - started, error: String(error).slice(0, 4000)}); checkpoint(); return false;}
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
        execFileSync(process.execPath, ['scripts/ring-cook.mjs', '--ring2', `--only=${head.slug}`, `--out=${cooked}`, `--build=${build}`, '--timeout-ms=300000'],
          {stdio: 'inherit', timeout: 330000});
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
      const bank = JSON.parse(bankText) as {spawnManifests: {client: Record<string, unknown>}};
      for (const slug of Object.keys(bank.spawnManifests.client)) if (bareSlug(slug) === bareSlug(head.slug)) delete bank.spawnManifests.client[slug];
      writeFileSync(join(dist, 'index.html'), originalHTML.replace(expression, (_, before, _body, after) => `${before}${JSON.stringify(bank)}${after}`));
      const added = await addStoredShards(dist, [head], store,
        hash => Promise.resolve(readFileSync(join(process.env.WILDSHARD_PIN_CACHE ?? join(homedir(), '.cache/wildshard/pins'), `${hash}.tar`))),
        {base: `http://127.0.0.1:${address.port}`, shards: []}, live);
      if (added.length !== 1 || added[0] !== head.slug) throw new Error('Cold cook was not attached');
      const titlesText = /<script type="application\/json" id="ws-title-rows">([^<]*)<\/script>/u.exec(readFileSync(join(dist, 'index.html'), 'utf8'))?.[1];
      if (titlesText === undefined) throw new Error('No title routes');
      const title = (JSON.parse(titlesText) as {slug: string; shardSelect?: boolean}[]).find(row => bareSlug(row.slug) === bareSlug(head.slug));
      if (title === undefined) throw new Error(`No title route for ${head.slug}`);
      const route = title.slug, mode = title.shardSelect === false ? 'arrival' : 'standalone';
      browser = browserName === 'webkit' ? await webkit.launch({headless: true}) : await chromium.launch({headless: true,
        args: [`--use-angle=${process.platform === 'darwin' ? 'metal' : 'swiftshader'}`, '--ignore-gpu-blocklist', '--mute-audio']});
      const activeBrowser = browser, url = preview.url;
      await phase('boot', async () => {
        const boot = await bootCase(activeBrowser, url, mode, evidence, route, true, async page => {
          await phase('hover', async () => {
            const control = page.locator('.ws-touch-hover');
            await control.tap({timeout: 5000});
            await page.waitForFunction(() => {
              const world = window.__wildshard?.world;
              return world?.player.hover === true && world.player.hoverBlend > 0.5 &&
                world.weapons.tools.some(tool => tool.id === 'tool.hoverboard' && tool.enabled && 'model' in tool && tool.model instanceof Object && 'visible' in tool.model && tool.model.visible === true);
            }, undefined, {timeout: 10000});
            await control.tap({timeout: 5000});
            await page.waitForFunction(() => window.__wildshard?.world?.player.hover === false, undefined, {timeout: 10000});
            return {mounted: true, unmounted: true, input: 'real touch'};
          });
          await phase('draw', async () => {
            // Observe completed engine frames, including shadow/post/held passes.
            // Software-hosted timing and the advisory 150 threshold never gate.
            const samples = await page.evaluate(() => new Promise<number[]>((resolve, reject) => {
              const values: number[] = []; let frame = -1;
              const timer = setTimeout(() => reject(new Error('No 30 completed draw frames in 60s')), 60000);
              const tick = () => {
                const game = window.__wildshard?.world?.game;
                if (game !== undefined && game.frameCount !== frame && game.lastFrame?.calls > 0) {
                  frame = game.frameCount; values.push(game.lastFrame.calls);
                }
                if (values.length < 30) requestAnimationFrame(tick);
                else {clearTimeout(timer); resolve(values);}
              }; requestAnimationFrame(tick);
            }));
            return {reportOnly: true, frames: samples.length, maxCalls: Math.max(...samples), advisory: 150, samples};
          });
        }, async context => {
          for (const fixture of levelDownloadFixtures('packs')) await saveFixture(context, fixture);
          if (mode === 'arrival') await saveFixture(context, {scope: 'session', key: 'travel.handoff', data: {
            v: 1, from: null, to: route, mode: 'enter', arrive: null, carry: [], at: Date.now(),
          }});
        });
        const clientKeys = new Set(index.keys.filter(key => !key.startsWith('assets/spawn/server/')));
        const used = [...fetched].filter(key => clientKeys.has(key));
        if (!used.some(key => /^assets\/spawn\/parts\/[a-f0-9]+\.pack\.br$/u.test(key))) throw new Error('No client part from this cold cook reached gameplay');
        if ([...fetched].some(key => !index.keys.includes(key))) throw new Error('Page fetched an object outside this head cook');
        return {route, entry: mode, gameplayFrames: boot.frame, ms: boot.elapsedMs, fetched: used};
      });
      await phase('explorer', async () => {await sweepExplorer(activeBrowser, url, route, evidence, true); return {route, rendered: true};});
    } catch (error) {
      if (!result.phases.some(row => row.name === 'boot')) result.phases.push({name: 'boot', ok: false, error: String(error).slice(0, 4000)});
      checkpoint();
    } finally {
      await browser?.close().catch(retirementFailed);
      if (packs !== undefined) {
        const server = packs; server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {server.close(error => {if (error === undefined) resolve(); else reject(error);});}).catch(retirementFailed);
      }
      // Own generated outputs only. Reports are checkpointed separately from large packs/captures.
      rmSync(cooked, {recursive: true, force: true}); rmSync(evidence, {recursive: true, force: true});
    }
  }
} finally {preview?.close(); writeFileSync(join(dist, 'index.html'), originalHTML); rmSync(work, {recursive: true, force: true}); checkpoint();}
if (report.results.some(row => row.phases.length !== 5 || row.phases.some(phase => !phase.ok))) process.exitCode = 1;
