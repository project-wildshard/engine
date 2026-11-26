// TC39/J186: explicit integration observation, outside hook discovery.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer, type ServerResponse} from 'node:http';
import {delimiter, resolve} from 'node:path';
import {test} from 'node:test';
import {observeApiHealth} from './api-health.ts';
import {lockedFormatVersion} from './format-lock.mjs';
import {browsers, phases, requirePublishedGreen, testGroups, type Plan, type Verdict} from './nightly-model.ts';

const lock = readFileSync('pnpm-lock.yaml', 'utf8'), expected = lockedFormatVersion(lock);
const health = {ok: true, version: 'test-api-build', shardFormat: expected};

async function withHealth(reply: (response: ServerResponse) => void, run: (url: string) => Promise<void>, redirectTarget = false): Promise<void> {
  const server = createServer((request, response) => {
    if (redirectTarget && request.url === '/matching-health') {response.end(JSON.stringify(health)); return;}
    assert.equal(request.url, '/api/health');
    reply(response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  try {await run(`http://127.0.0.1:${address.port}/api/health`);}
  finally {server.closeAllConnections(); await new Promise<void>((_resolve, reject) => {
    server.close(error => {if (error) reject(error); else _resolve();});
  });}
}

await test('real HTTP health matches the resolved package and reports a mismatch', {timeout: 5000}, async () => {
  for (const observed of [expected, '999.0.0']) await withHealth(response => {response.end(JSON.stringify({...health, shardFormat: observed}));}, async url => {
    const report = await observeApiHealth(lock, url);
    assert.equal(report.complete, true);
    assert.equal(report.ok, observed === expected);
    assert.equal(report.expected, expected);
    assert.equal(report.observed, observed);
    assert.equal(report.apiBuild, health.version);
    if (observed !== expected) assert.match(report.error ?? '', /format mismatch/u);
  });
});

await test('actual CLI writes the observed receipt and exits nonzero for a planted mismatch', {timeout: 5000}, async () => {
  mkdirSync('tmp', {recursive: true});
  const folder = mkdtempSync(resolve('tmp/api-health-proof-')), output = resolve(folder, 'report.json');
  try {
    for (const observed of [expected, '999.0.0']) await withHealth(response => {response.end(JSON.stringify({...health, shardFormat: observed}));}, async url => {
      const child = spawn(process.execPath, ['src/scripts/api-health.ts', url, output], {stdio: ['ignore', 'pipe', 'pipe'],
        env: {...process.env, GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123'}});
      let stderr = '';
      child.stderr.on('data', chunk => {stderr += String(chunk);});
      child.stdout.resume();
      const [code] = await once(child, 'exit');
      assert.equal(code, observed === expected ? 0 : 1, stderr);
      const report = JSON.parse(readFileSync(output, 'utf8')) as Record<string, unknown>;
      assert.equal(report.complete, true); assert.equal(report.observed, observed);
      assert.equal(report.sha, 'a'.repeat(40)); assert.equal(report.run, '123');
      assert.match(String(report.lockHash), /^[a-f0-9]{64}$/u);
    });
  } finally {rmSync(folder, {recursive: true, force: true});}
});

await test('missing, malformed and unhealthy HTTP bodies refuse a match', {timeout: 5000}, async () => {
  for (const body of [null, {}, {...health, shardFormat: undefined}, {...health, shardFormat: '^0.7.0'},
    {...health, shardFormat: 7}, {...health, ok: false}, {...health, version: ''}, '{broken'])
    await withHealth(response => {response.end(typeof body === 'string' ? body : JSON.stringify(body));}, async url => {
      const report = await observeApiHealth(lock, url);
      assert.equal(report.complete, false); assert.equal(report.ok, false); assert.equal(report.observed, null);
      assert.ok(report.error);
    });
});

await test('HTTP errors, redirects and broken transport refuse a match', {timeout: 5000}, async () => {
  for (const reply of [(response: ServerResponse) => {response.writeHead(503); response.end(JSON.stringify(health));},
    (response: ServerResponse) => {response.writeHead(302, {location: '/matching-health'}); response.end();},
    (response: ServerResponse) => {response.destroy();}])
    await withHealth(reply, async url => {
      const report = await observeApiHealth(lock, url);
      assert.equal(report.complete, false); assert.equal(report.ok, false); assert.ok(report.error);
    }, true);
});

await test('the deadline also aborts a body stalled after headers', {timeout: 5000}, async () => {
  for (const stalledBody of [false, true]) {
    let flushed: number | undefined;
    await withHealth(response => {
      if (stalledBody) {
        response.writeHead(200, {'content-type': 'application/json'});
        response.write('{', () => {flushed = performance.now();});
      }
    }, async url => {
      const started = performance.now(), report = await observeApiHealth(lock, url, 500);
      assert.equal(report.complete, false); assert.equal(report.ok, false);
      assert.match(report.error ?? '', /Timeout|Abort/u);
      assert.ok(performance.now() - started < 2000, 'deadline must bound the entire HTTP operation');
      if (stalledBody) assert.ok(flushed !== undefined && flushed - started < 500, 'body must stall after headers arrived before the deadline');
    });
  }
});

await test('lock resolution wins over a caret lower bound; incomplete or ambiguous locks fail before HTTP', {timeout: 5000}, async () => {
  const registry = (version: string, rows = `'@wildshard/shard-format@${version}':\n    resolution: {integrity: sha512-test}`) =>
    `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      '@wildshard/format':\n        specifier: npm:@wildshard/shard-format@^0.7.0\n        version: '@wildshard/shard-format@${version}'\n\npackages:\n\n  ${rows}\n`;
  assert.equal(lockedFormatVersion(registry('0.7.9')), '0.7.9');
  assert.equal(lockedFormatVersion(registry('0.7.9').replace("version: '@wildshard/shard-format@0.7.9'", "version: '@wildshard/shard-format@0.7.9(typescript@6.0.3)'")), '0.7.9');
  for (const observed of ['0.7.9', '0.7.0']) await withHealth(response => {response.end(JSON.stringify({...health, shardFormat: observed}));}, async url => {
    const report = await observeApiHealth(registry('0.7.9'), url);
    assert.equal(report.expected, '0.7.9');
    assert.equal(report.ok, observed === '0.7.9');
  });
  const commit = 'b'.repeat(40);
  const gitLock = `lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n      '@wildshard/format':\n        specifier: github:project-wildshard/shard-format#v0.7.9\n        version: git+ssh://git@github.com/project-wildshard/shard-format.git#${commit}\n\npackages:\n  '@wildshard/shard-format@git+ssh://git@github.com/project-wildshard/shard-format.git#${commit}':\n    resolution: {commit: ${commit}, repo: https://github.com/project-wildshard/shard-format.git, type: git}\n    version: 0.7.9\n`;
  assert.equal(lockedFormatVersion(gitLock), '0.7.9');
  const url = `https://codeload.github.com/project-wildshard/shard-format/tar.gz/${commit}`;
  const codeload = gitLock.replace(`git+ssh://git@github.com/project-wildshard/shard-format.git#${commit}`, `'@wildshard/shard-format@${url}(typescript@6.0.3)'`)
    .replace(`'@wildshard/shard-format@git+ssh://git@github.com/project-wildshard/shard-format.git#${commit}'`, `'@wildshard/shard-format@${url}'`)
    .replace(`{commit: ${commit}, repo: https://github.com/project-wildshard/shard-format.git, type: git}`, `{gitHosted: true, tarball: ${url}}`);
  assert.equal(lockedFormatVersion(codeload), '0.7.9');
  for (const bad of ['', registry('0.7.9', ''), registry('0.7.9').replace('version:', 'missing:'),
    registry('0.7.9', "'@wildshard/shard-format@0.7.8':\n    resolution: {integrity: sha512-test}"),
    registry('0.7.9', "'@wildshard/shard-format@0.7.9':\n    resolution: {integrity: sha512-a}\n  '@wildshard/shard-format@0.7.9':\n    resolution: {integrity: sha512-b}")]) {
    const report = await observeApiHealth(bad, 'not a valid URL');
    assert.equal(report.complete, false); assert.equal(report.ok, false);
    assert.match(report.error ?? '', /pnpm-lock.yaml/u);
  }
});

// CI has a frozen install. The isolated nightly observer intentionally needs no install.
await test('real lock resolution agrees with the installed validator package', {skip: process.env.TC39_INSTALLED_FORMAT !== '1'}, () => {
  const installed = JSON.parse(readFileSync('node_modules/@wildshard/format/package.json', 'utf8')) as {name: string; version: string};
  assert.equal(installed.name, '@wildshard/shard-format');
  assert.equal(expected, installed.version);
});

await test('diagnostic dispatches cannot displace the scheduled nightly used for qualification', {timeout: 5000}, () => {
  const expectedNight: Plan = {version: 2, sha: 'a'.repeat(40), pins: 'b'.repeat(64), testList: 'c'.repeat(64),
    heads: [{slug: 'example', hash: 'd'.repeat(64)}], tests: ['test/example.ts']};
  const report: Verdict = {version: 2, sha: expectedNight.sha, pins: expectedNight.pins, testList: expectedNight.testList,
    ok: true, tag: 'eligible', rows: browsers.flatMap(browser => phases.map(phase => ({browser, phase, slug: 'example', hash: 'd'.repeat(64), ok: true}))),
    failures: [], tests: Array.from({length: testGroups}, (_, group) => ({group, ok: true, files: 1, assertions: 1})),
    run: '42', baseline: null, newFailures: [], resolved: []};
  mkdirSync('tmp', {recursive: true});
  const folder = mkdtempSync(resolve('tmp/api-health-nightly-proof-')), gh = resolve(folder, 'gh'), savedPath = process.env.PATH;
  try {
    // The real production reader executes gh. Only scheduled queries get the
    // full-night id; an unfiltered query returns the newer diagnostic id.
    writeFileSync(gh, `#!/usr/bin/env node\nconst args=process.argv.slice(2);if(args[0]!=='api'||args[2]!=='--jq'||args[3]!=='.workflow_runs[0]')throw Error('unexpected gh query');const scheduled=args.some(arg=>arg.includes('event=schedule'));console.log(JSON.stringify({id:scheduled?42:43,head_sha:'${expectedNight.sha}',status:'completed',conclusion:'success'}));\n`);
    chmodSync(gh, 0o755);
    process.env.PATH = `${folder}${delimiter}${savedPath ?? ''}`;
    requirePublishedGreen(report, expectedNight);
    assert.throws(() => requirePublishedGreen({...report, run: '41'}, expectedNight), /latest completed nightly/u);
  } finally {
    if (savedPath === undefined) Reflect.deleteProperty(process.env, 'PATH'); else process.env.PATH = savedPath;
    rmSync(folder, {recursive: true, force: true});
  }
});
