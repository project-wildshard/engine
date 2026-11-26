// Meta STAGING-SMOKE SM1 (J398): the runner and its five scenarios. The browser runs need a browser, so they run only by
// name, in the browser lane:
//   WS_SMOKE_BROWSER=1 src/scripts/browser-lane.sh --max 10 pnpm exec vitest run test/staging-smoke-runner.test.ts
//   WS_SMOKE_BUILD=http://127.0.0.1:<port> (src/scripts/serve-build.sh) adds the real local build, K3 to K5 clean.
// oxlint-disable-next-line import/no-nodejs-modules -- It serves a stub page and reads the run's files.
import { existsSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import type { AddressInfo } from 'node:net';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { parseArgs, runSmoke } from '../src/scripts/staging-smoke.mjs';
import { dropLeadingTitle } from '../src/scripts/staging-smoke/scenarios.mjs';

const OUT = resolve('tmp/staging-smoke-test');
const BROWSER = process.env['WS_SMOKE_BROWSER'] === '1', BUILD = process.env['WS_SMOKE_BUILD'];
const screen = (over: Record<string, boolean | number>) => ({ doc: 1, path: '/', shell: false, title: false, select: false, loading: false, bar: false, hud: false, modal: false, ...over });

test('the grid card sits on the title: K5 judges from the first other screen, as the tap document', () => {
  const rows = [{ t: 0, s: screen({ title: true }) }, { t: 120, s: screen({ title: true }) }, { t: 240, s: screen({ doc: 2, loading: true }) }, { t: 360, s: screen({ doc: 2, hud: true }) }];
  const kept = dropLeadingTitle(rows);
  expect(kept.map(r => r.t)).toEqual([240, 360]);
  expect(kept[0]?.s?.doc).toBe(1);
  expect(dropLeadingTitle([{ t: 0, s: screen({ loading: true }) }])).toHaveLength(1);
});

test('the CLI reads flags and refuses production', async () => {
  expect([...parseArgs(['--url', 'http://x', '--only', 'K3,K4', '--dry'])]).toEqual([['url', 'http://x'], ['only', 'K3,K4'], ['dry', 'true']]);
  await expect(runSmoke({ url: 'https://wildshard.io', release: 'v0', out: join(OUT, 'prod'), log: () => undefined })).rejects.toThrow(/never production/u);
});

test('SM8: the runner prints its total time and warns over its budget', async () => {
  const lines: string[] = [];
  await runSmoke({ url: 'http://127.0.0.1:9', release: 'v0', out: join(OUT, 'budget'), only: [], runBudgetS: -1, log: line => { lines.push(line); } });
  expect(lines.find(line => line.startsWith('staging-smoke v0:'))).toMatch(/0 scenarios in \d+ s WARNING: over the -0\.0\d+-minute budget \(SM8\)/u);
  const quiet: string[] = [];
  await runSmoke({ url: 'http://127.0.0.1:9', release: 'v0', out: join(OUT, 'budget'), only: [], log: line => { quiet.push(line); } });
  expect(quiet.find(line => line.startsWith('staging-smoke v0:'))).toMatch(/0 scenarios in \d+ s$/u);
});

test.skipIf(!BROWSER)('a stub that serves the main menu after Enter World fails K3', async () => {
  const html = readFileSync('test/fixtures/staging-smoke/menu-loop.html');
  const server = createServer((request, response) => {
    if ((request.url ?? '/').startsWith('/version.json')) response.writeHead(200, { 'content-type': 'application/json' }).end('{"build":"stub"}');
    else response.writeHead(200, { 'content-type': 'text/html' }).end(html);
  });
  await new Promise<void>(ready => { server.listen(0, '127.0.0.1', ready); });
  const { port } = server.address() as AddressInfo;
  const out = join(OUT, 'stub');
  rmSync(out, { recursive: true, force: true });
  try {
    const verdict = await runSmoke({ url: `http://127.0.0.1:${String(port)}`, release: 'v0.0.0-stub', out, only: ['K3'], budgetMs: 8000, log: () => undefined });
    const k3 = verdict.scenarios[0];
    expect(k3?.id).toBe('K3');
    expect(k3?.settings).toEqual({ opened: true, closed: true });
    const problems = (k3?.legs ?? []).flatMap(leg => leg.problems.map(p => p.text));
    expect(problems).toContain('the main menu came back after Enter World');
    expect(problems).toContain('never reached play within 8000 ms');
  } finally { server.close(); }
}, 400_000);

test.skipIf(BUILD === undefined)('the local build: K3 to K5 run clean, one clip each', async () => {
  if (BUILD === undefined) return;
  const out = join(OUT, 'build');
  rmSync(out, { recursive: true, force: true });
  const lines: string[] = [];
  const verdict = await runSmoke({ url: BUILD, release: 'v0.0.0-local', out, only: ['K3', 'K4', 'K5'], watchMs: 10_000, log: line => { lines.push(line); } });
  expect(verdict.scenarios.map(s => `${s.id} ${s.status}`), lines.join('\n')).toEqual(['K3 ran', 'K4 ran', 'K5 ran']);
  for (const s of verdict.scenarios) {
    expect(s.legs.flatMap(leg => leg.problems.map(p => `${leg.name}: ${p.text}`)), `${s.id}\n${s.log.join('\n')}`).toEqual([]);
    expect(s.video?.endsWith(`${s.id}.mp4`), s.id).toBe(true);
    expect(existsSync(s.video ?? ''), s.id).toBe(true);
  }
  expect(verdict.scenarios[0]?.settings).toEqual({ opened: true, closed: true });
}, 900_000);
