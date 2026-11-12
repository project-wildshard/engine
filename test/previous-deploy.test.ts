// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns only temporary build outputs.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixture's output under ./tmp.
import {join, resolve as resolvePath} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the production manifest/body HTTP path locally.
import {createServer} from 'node:http';
import {expect, test} from 'vitest';
import {CHUNK, carryPreviousDeploy, channelOrigin, liveDeployBuilds, previousDeployOptional} from '../scripts/app-build/previousDeploy.mjs';
import {KEEP_PROMOTED} from '../scripts/prune-deployments.mjs';

test('a deploy carries the kept builds unchanged, but never one past the prune, nor a map', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-'));
  const output = (name: string, code: string): string => {
    const dir = join(root, name); mkdirSync(join(dir, `b/${name}`), {recursive: true});
    writeFileSync(join(dir, 'version.json'), JSON.stringify({build: name}));
    writeFileSync(join(dir, `b/${name}/main-${name.repeat(8)}.js`), code);
    writeFileSync(join(dir, `b/${name}/main-${name.repeat(8)}.css`), `.${name}{color:red}`);
    writeFileSync(join(dir, `b/${name}/main-${name.repeat(8)}.js.map`), 'private'); return dir;
  };
  try {
    const a = output('a', 'export const title="A";'); await carryPreviousDeploy(a);
    const b = output('b', 'export const title="B";');
    expect(await carryPreviousDeploy(b, {previousDirectory: a})).toMatchObject({current: 2, builds: 2, carried: 2});
    for (const ext of ['js', 'css']) expect(readFileSync(join(b, `b/a/main-aaaaaaaa.${ext}`))).toEqual(readFileSync(join(a, `b/a/main-aaaaaaaa.${ext}`)));
    expect(existsSync(join(b, 'b/a/main-aaaaaaaa.js.map'))).toBe(false);
    const manifest: unknown = JSON.parse(readFileSync(join(b, 'deploy-chunks.json'), 'utf8'));
    expect(manifest).toEqual({format: 2, builds: [
      {build: 'b', files: [{path: 'b/b/main-bbbbbbbb.css', bytes: 13}, {path: 'b/b/main-bbbbbbbb.js', bytes: 23}]},
      {build: 'a', files: [{path: 'b/a/main-aaaaaaaa.css', bytes: 13}, {path: 'b/a/main-aaaaaaaa.js', bytes: 23}]},
    ]});
    let previous = b;
    for (const name of ['c', 'd', 'e', 'f']) {
      const next = output(name, `export const title="${name}";`); await carryPreviousDeploy(next, {previousDirectory: previous}); previous = next;
    }
    // KEEP_PROMOTED: f and the four before it, so a is past the prune.
    expect(KEEP_PROMOTED).toBe(5);
    expect(existsSync(join(previous, 'b/b/main-bbbbbbbb.js'))).toBe(true);
    expect(existsSync(join(previous, 'b/a/main-aaaaaaaa.js'))).toBe(false);
    expect(readFileSync(join(previous, 'b/f/main-ffffffff.js'), 'utf8')).toBe('export const title="f";');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('PZ5: a carried build carries its code only, never assets/spawn/, a grid file or other content', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-code-'));
  // What staging's and play's live deploy-chunks.json name today, one of each kind, beside the build's code.
  const content = ['assets/spawn/_template-client-desktop-54ce6c8d049d9b8c.json', 'assets/spawn/server-aaaaaaaa.json',
    'assets/grid-strip-mesh-46c94ae4.bin', 'assets/boot-far-reach-ea97d653.json', 'assets/world-map-b44497c7518e2f3f.webp',
    'assets/baked/pine-hollow/far-impostor.png', 'assets/title/driftwood-isle-portrait-e9d5c9aedd5c5920.jpg'];
  const code = ['b/old/main-aaaaaaaa.js', 'b/old/base-aaaaaaaa.css', 'b/old/standalone/basis-aaaaaaaa.wasm', 'b/c/shared-aaaaaaaa.js', 'b/old/flags.json'];
  const output = (name: string, paths: readonly string[]): string => {
    const dir = join(root, name); mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, 'version.json'), JSON.stringify({build: name}));
    for (const path of paths) { mkdirSync(join(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), path); }
    return dir;
  };
  const isContent = (path: string): boolean => path.startsWith('assets/spawn/') || /^assets\/grid-/u.test(path) || !CHUNK.test(path);
  try {
    // A build that reads its content from a content base marks its graph and names its code only.
    const old = output('old', [...code, ...content]); await carryPreviousDeploy(old, {contentBase: true});
    const oldGraph = (JSON.parse(readFileSync(join(old, 'deploy-chunks.json'), 'utf8')) as {builds: {content?: boolean; files: {path: string}[]}[]}).builds[0];
    expect(oldGraph).toMatchObject({content: true});
    expect(oldGraph?.files.map(row => row.path).sort()).toEqual([...code].sort());
    for (const path of content) expect(CHUNK.test(path), path).toBe(false);
    for (const path of code) expect(CHUNK.test(path), path).toBe(true);

    const carriedOnce = async (name: string): Promise<{build: string; content?: boolean; files: {path: string}[]}[]> => {
      const next = output(name, [`b/${name}/main-bbbbbbbb.js`, 'assets/spawn/server-bbbbbbbb.json', 'assets/grid-strip-mesh-bbbbbbbb.bin']);
      expect(await carryPreviousDeploy(next, {previousDirectory: old, contentBase: true})).toMatchObject({current: 1, builds: 2, carried: code.length});
      for (const path of code) expect(readFileSync(join(next, path), 'utf8')).toBe(path);
      for (const path of content) expect(existsSync(join(next, path)), path).toBe(false);
      return (JSON.parse(readFileSync(join(next, 'deploy-chunks.json'), 'utf8')) as {builds: {build: string; content?: boolean; files: {path: string}[]}[]}).builds;
    };
    // Neither graph names content, so the next release never asks the page for it.
    const builds = await carriedOnce('next');
    expect(builds.map(row => row.build)).toEqual(['next', 'old']);
    expect(builds.flatMap(row => row.files.map(file => file.path)).filter(isContent)).toEqual([]);
    expect(builds.every(row => row.content === true)).toBe(true);
    // A marked graph that names content anyway (an older writer) still carries its code only, and is written back as code.
    writeFileSync(join(old, 'deploy-chunks.json'), JSON.stringify({format: 2, builds: [{build: 'old', content: true, files: [...code, ...content].map(path => ({path, bytes: path.length}))}]}));
    expect((await carriedOnce('again'))[1]?.files.map(row => row.path).sort()).toEqual([...code].sort());
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('PZ5: a kept build whose tabs read content from the page still carries its content, until it ages out', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-page-'));
  const paths = ['b/pre/main-aaaaaaaa.js', 'assets/spawn/pine-hollow-client-phone-54ce6c8d049d9b8c.json', 'assets/grid-strip-mesh-46c94ae4.bin'];
  try {
    const pre = join(root, 'pre'); mkdirSync(pre); writeFileSync(join(pre, 'version.json'), '{"build":"pre"}');
    for (const path of paths) { mkdirSync(join(pre, path, '..'), {recursive: true}); writeFileSync(join(pre, path), path); }
    // A build from before the content base: no mark, and it names its content.
    await carryPreviousDeploy(pre);
    const first = join(root, 'first'); mkdirSync(first); writeFileSync(join(first, 'version.json'), '{"build":"first"}');
    expect(await carryPreviousDeploy(first, {previousDirectory: pre, contentBase: true})).toMatchObject({builds: 2, carried: paths.length});
    for (const path of paths) expect(readFileSync(join(first, path), 'utf8')).toBe(path);
    const manifest = JSON.parse(readFileSync(join(first, 'deploy-chunks.json'), 'utf8')) as {builds: {build: string; content?: boolean}[]};
    expect(manifest.builds).toMatchObject([{build: 'first', content: true}, {build: 'pre'}]);
    expect(manifest.builds[1]).not.toHaveProperty('content');
    writeFileSync(join(pre, 'deploy-chunks.json'), JSON.stringify({format: 2, builds: [{build: 'pre', content: 'yes', files: []}]}));
    await expect(carryPreviousDeploy(first, {previousDirectory: pre})).rejects.toThrow('Invalid previous deploy chunk manifest');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('PZ5: gc reads every channel\'s live builds, and refuses when a channel shows none', async () => {
  const manifests: Record<string, unknown> = {
    'https://play.test': {format: 2, builds: [{build: 'p1', files: []}, {build: 'p2', files: [{path: 'b/p2/main-aaaaaaaa.js', bytes: 1}]}]},
    'https://staging.test': {format: 1, build: 's1', files: []},
  };
  const get = (async (url: URL | string): Promise<Response> => {
    const at = new URL(url);
    expect(at.pathname).toBe('/deploy-chunks.json');
    const body = manifests[at.origin];
    return body === undefined ? new Response('<html>', {status: 200, headers: {'content-type': 'text/html'}}) : Response.json(body);
  }) as typeof fetch;
  expect(await liveDeployBuilds(get, {production: 'https://play.test', staging: 'https://staging.test'}))
    .toEqual([{channel: 'production', builds: ['p1', 'p2']}, {channel: 'staging', builds: ['s1']}]);
  await expect(liveDeployBuilds(get, {production: 'https://play.test', preview: 'https://preview.test'})).rejects.toThrow(/preview .* no garbage collection/u);
  manifests['https://staging.test'] = {format: 2, builds: []};
  await expect(liveDeployBuilds(get, {staging: 'https://staging.test'})).rejects.toThrow(/staging .* names no build/u);
});

test('the format production published before the pointer still carries', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-format-'));
  try {
    const current = join(root, 'new'), previous = join(root, 'old'); mkdirSync(current); mkdirSync(join(previous, 'assets'), {recursive: true});
    writeFileSync(join(current, 'version.json'), '{"build":"new"}');
    writeFileSync(join(previous, 'assets/main-aaaaaaaa.js'), 'old');
    writeFileSync(join(previous, 'deploy-chunks.json'), JSON.stringify({format: 1, build: 'old', files: [{path: 'assets/main-aaaaaaaa.js', bytes: 3}]}));
    expect(await carryPreviousDeploy(current, {previousDirectory: previous})).toMatchObject({builds: 2, carried: 1});
    expect(readFileSync(join(current, 'assets/main-aaaaaaaa.js'), 'utf8')).toBe('old');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('untrusted predecessor paths and missing bytes refuse instead of publishing a broken graph', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-refusal-'));
  try {
    const current = join(root, 'new'), previous = join(root, 'old'); mkdirSync(current); mkdirSync(previous);
    writeFileSync(join(current, 'version.json'), '{"build":"new"}');
    for (const path of ['../outside-aaaaaaaa.js', 'assets/../outside-aaaaaaaa.js', 'https://other.test/main-aaaaaaaa.js', 'assets/main.js']) {
      writeFileSync(join(previous, 'deploy-chunks.json'), JSON.stringify({format: 1, build: 'old', files: [{path, bytes: 1}]}));
      await expect(carryPreviousDeploy(current, {previousDirectory: previous})).rejects.toThrow('Invalid previous deploy chunk row');
    }
    writeFileSync(join(previous, 'deploy-chunks.json'), JSON.stringify({format: 1, build: 'old', files: [{path: 'assets/main-aaaaaaaa.js', bytes: 1}]}));
    await expect(carryPreviousDeploy(current, {previousDirectory: previous})).rejects.toThrow();
    expect(existsSync(join(current, 'deploy-chunks.json'))).toBe(false);
  } finally {rmSync(root, {recursive: true, force: true});}
});


test('the production HTTP carry preserves old JS/CSS and refuses a truncated body', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-http-'));
  const bodies = new Map([['assets/old-aaaaaaaa.js', 'export const old=1;'], ['assets/old-bbbbbbbb.css', 'body{color:red}']]);
  const manifest = {format: 1, build: 'previous', files: [...bodies].map(([path, body]) => ({path, bytes: Buffer.byteLength(body)}))};
  let truncate = false;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').slice(1); requests.push(path);
    if (path === 'deploy-chunks.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(manifest)); return; }
    const body = bodies.get(path);
    if (body === undefined) {response.writeHead(404); response.end(); return;}
    response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript');
    response.end(truncate ? body.slice(1) : body);
  });
  await new Promise<void>(resolve => {server.listen(0, '127.0.0.1', resolve);});
  try {
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No fixture port');
    const options = {previousOrigin: `http://127.0.0.1:${address.port}`};
    writeFileSync(join(root, 'version.json'), '{"build":"new"}');
    expect(await carryPreviousDeploy(root, options)).toMatchObject({current: 0, carried: 2});
    expect(requests).toEqual(['deploy-chunks.json', ...bodies.keys()]);
    for (const [path, body] of bodies) expect(readFileSync(join(root, path), 'utf8')).toBe(body);
    requests.length = 0;
    expect(await carryPreviousDeploy(root, options)).toMatchObject({current: 2, carried: 0, bytes: 0});
    expect(requests).toEqual(['deploy-chunks.json']);
    truncate = true;
    const failed = join(root, 'failed'); mkdirSync(failed); writeFileSync(join(failed, 'version.json'), '{"build":"failed"}');
    await expect(carryPreviousDeploy(failed, options)).rejects.toThrow('Previous deploy chunk length differs');
    // Production moved on while a release built: that build drops out whole, and the build still ships.
    truncate = false; manifest.files.push({path: 'assets/gone-cccccccc.js', bytes: 1});
    const moved = join(root, 'moved'); mkdirSync(moved); writeFileSync(join(moved, 'version.json'), '{"build":"moved"}');
    expect(await carryPreviousDeploy(moved, options)).toMatchObject({builds: 1, carried: 0, bytes: 0});
    for (const path of bodies.keys()) expect(existsSync(join(moved, path))).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) => {server.close(error => {if (error === undefined) resolve(); else reject(error);});});
    rmSync(root, {recursive: true, force: true});
  }
});

test('J217 (LD6): a newer deploy shares unchanged code and still serves an old build every file it names', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-shared-'));
  const output = (name: string, shared: Readonly<Record<string, string>>): string => {
    const dir = join(root, name); mkdirSync(join(dir, `b/${name}`), {recursive: true}); mkdirSync(join(dir, 'b/c'), {recursive: true});
    writeFileSync(join(dir, 'version.json'), JSON.stringify({build: name}));
    writeFileSync(join(dir, `b/${name}/main-${name.repeat(8)}.js`), `import "../c/${Object.keys(shared).join('";import "../c/')}";`);
    for (const [file, body] of Object.entries(shared)) writeFileSync(join(dir, `b/c/${file}`), body);
    return dir;
  };
  try {
    // The old build's page holds its entry, the chunk both builds share, and the chunk only it uses.
    const old = output('a', {'world-11111111.js': 'world', 'oldonly-22222222.js': 'old'}); await carryPreviousDeploy(old);
    const next = output('b', {'world-11111111.js': 'world', 'newonly-33333333.js': 'new'});
    expect(await carryPreviousDeploy(next, {previousDirectory: old})).toMatchObject({builds: 2, carried: 2});
    // Every file the old build names is in the newer deploy, unchanged: its entry and its own chunk carried, the shared one once.
    const manifest = JSON.parse(readFileSync(join(next, 'deploy-chunks.json'), 'utf8')) as {builds: {build: string; files: {path: string}[]}[]};
    const oldGraph = manifest.builds.find(row => row.build === 'a');
    expect(oldGraph?.files.map(row => row.path)).toEqual(['b/a/main-aaaaaaaa.js', 'b/c/oldonly-22222222.js', 'b/c/world-11111111.js']);
    for (const row of oldGraph?.files ?? []) expect(readFileSync(join(next, row.path))).toEqual(readFileSync(join(old, row.path)));
    expect(manifest.builds.find(row => row.build === 'b')?.files.map(row => row.path)).toEqual(['b/b/main-bbbbbbbb.js', 'b/c/newonly-33333333.js', 'b/c/world-11111111.js']);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('a kept build whose chunk this build writes with other bytes is dropped whole, and the build goes on', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-clash-'));
  const output = (name: string, files: Record<string, string>): string => {
    const dir = join(root, name); writeFileSync(join(mkdirSync(dir, {recursive: true}) ?? dir, 'version.json'), JSON.stringify({build: name}));
    for (const [path, code] of Object.entries(files)) { mkdirSync(join(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), code); }
    return dir;
  };
  try {
    // the same content-hash name, other bytes: the importer lists a dependency named after another checkout
    const old = output('old', {'b/c/late-dummy-Ci9ql7Om.js': 'import("b/c/engine-source-X.js")', 'b/c/old-only-AAAAAAAA.js': 'old'});
    await carryPreviousDeploy(old);
    const now = output('now', {'b/c/late-dummy-Ci9ql7Om.js': 'import("b/c/shared-X.js")'});
    expect(await carryPreviousDeploy(now, {previousDirectory: old})).toMatchObject({carried: 0});
    expect(readFileSync(join(now, 'b/c/late-dummy-Ci9ql7Om.js'), 'utf8')).toBe('import("b/c/shared-X.js")');
    expect(existsSync(join(now, 'b/c/old-only-AAAAAAAA.js'))).toBe(false);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('a clash with the deploy live right now, when it is ours, fails the build and names the file and the deploy', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-live-'));
  const output = (name: string, files: Record<string, string>): string => {
    const dir = join(root, name); mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, 'version.json'), JSON.stringify({build: name}));
    for (const [path, code] of Object.entries(files)) { mkdirSync(join(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), code); }
    return dir;
  };
  try {
    const live = output('live', {'b/c/late-dummy-Ci9ql7Om.js': 'import("b/c/engine-source-X.js")'});
    await carryPreviousDeploy(live);
    const next = output('next', {'b/c/late-dummy-Ci9ql7Om.js': 'import("b/c/shared-X.js")'});
    // the previous directory's own build is the live one; `ours` says it is this repository's
    await expect(carryPreviousDeploy(next, {previousDirectory: live, ours: () => true}))
      .rejects.toThrow(/b\/c\/late-dummy-Ci9ql7Om\.js in the live deploy live/u);
    // another repository's live build (the shell J210 retires) is replaced, with a warning
    await expect(carryPreviousDeploy(next, {previousDirectory: live, ours: () => false})).resolves.toMatchObject({carried: 0});
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('a paused production origin (503) stops a release build, but a CI test build warns once and carries nothing', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/previous-deploy-paused-'));
  // Vercel's spend cap answers every path 503 DEPLOYMENT_PAUSED (main ci 43111080979)
  let mode: 'paused' | 'reset' | 'garbage' = 'paused';
  const server = createServer((_request, response) => {
    if (mode === 'paused') {response.writeHead(503, {'x-vercel-error': 'DEPLOYMENT_PAUSED'}); response.end(); return;}
    response.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': '100'});
    if (mode === 'garbage') {response.end('{not json'.padEnd(100)); return;}
    response.write('{"format":'); setTimeout(() => {response.socket?.destroy();}, 10);
  });
  await new Promise<void>(resolve => {server.listen(0, '127.0.0.1', resolve);});
  const warned: string[] = [], warn = console.warn;
  console.warn = (...args: unknown[]): void => {warned.push(args.join(' '));};
  try {
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No fixture port');
    const previousOrigin = `http://127.0.0.1:${address.port}`;
    writeFileSync(join(root, 'version.json'), '{"build":"new"}');
    await expect(carryPreviousDeploy(root, {previousOrigin})).rejects.toThrow('Previous deploy manifest returned 503');
    expect(existsSync(join(root, 'deploy-chunks.json'))).toBe(false);
    expect(warned).toEqual([]);
    expect(await carryPreviousDeploy(root, {previousOrigin, optional: true})).toMatchObject({builds: 1, carried: 0});
    expect(warned).toEqual([`Previous deploy manifest unavailable (503 from ${previousOrigin}), so this test build carries no previous builds`]);
    // a refused origin (no server at all) is a network error: the same warning in a test build, a refusal in a release
    const closed = `http://127.0.0.1:1`;
    await expect(carryPreviousDeploy(root, {previousOrigin: closed})).rejects.toThrow();
    expect(await carryPreviousDeploy(root, {previousOrigin: closed, optional: true})).toMatchObject({builds: 1, carried: 0});
    expect(warned[1]).toMatch(/^Previous deploy manifest unavailable \(fetch failed from http:\/\/127\.0\.0\.1:1\)/u);
    // a reset after the headers is a transport failure too; a whole body that is not a manifest always refuses
    mode = 'reset';
    await expect(carryPreviousDeploy(root, {previousOrigin})).rejects.toThrow();
    expect(await carryPreviousDeploy(root, {previousOrigin, optional: true})).toMatchObject({builds: 1, carried: 0});
    expect(warned).toHaveLength(3);
    mode = 'garbage';
    await expect(carryPreviousDeploy(root, {previousOrigin, optional: true})).rejects.toThrow(SyntaxError);
  } finally {
    console.warn = warn;
    await new Promise<void>((resolve, reject) => {server.close(error => {if (error === undefined) resolve(); else reject(error);});});
    rmSync(root, {recursive: true, force: true});
  }
});

test('a release carries from its own channel, never a vercel.app address (OFF-VERCEL OV3)', () => {
  expect(channelOrigin('production')).toBe('https://play.wildshard.io');
  expect(channelOrigin('staging')).toBe('https://staging.wildshard.io');
  expect(channelOrigin('preview')).toBe('https://preview.wildshard.io');
  // CI's main push names no channel: it builds what production ships.
  expect(channelOrigin(undefined)).toBe('https://play.wildshard.io');
  expect(channelOrigin('')).toBe('https://play.wildshard.io');
  for (const wrong of ['constructor', 'wildshard-singleplayer.vercel.app']) expect(() => channelOrigin(wrong)).toThrow(/WS_CHANNEL/u);
  const pipeline = readFileSync('scripts/app-build-pipeline.mjs', 'utf8');
  expect(pipeline).not.toMatch(/vercel\.app|VERCEL_ENV/u);
  expect(pipeline).toContain('process.env.WS_RELEASE === "1"');
});

test('only a test build or the solo preview may treat an unreachable origin as no previous builds', () => {
  expect(previousDeployOptional({WS_PREVIOUS_DEPLOY_OPTIONAL: '1'})).toBe(true);
  expect(previousDeployOptional({WS_RELEASE: '1', WS_CHANNEL: 'preview'})).toBe(true);
  expect(previousDeployOptional({WS_RELEASE: '1', WS_CHANNEL: 'staging', WS_PREVIOUS_DEPLOY_OPTIONAL: '1'})).toBe(false);
  expect(previousDeployOptional({WS_RELEASE: '1', WS_CHANNEL: 'production', WS_PREVIOUS_DEPLOY_OPTIONAL: '1'})).toBe(false);
  expect(previousDeployOptional({})).toBe(false);
});
