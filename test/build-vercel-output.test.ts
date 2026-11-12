// oxlint-disable-next-line import/no-nodejs-modules -- Own an isolated packaging workspace.
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the maintained CLI with a controlled Vercel executable.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve owned temporary paths.
import {join, resolve} from 'node:path';
import {expect, test} from 'vitest';
import {sentryEnvironment} from '../scripts/build-vercel-output.mjs';

test.each([0, 7])('prebuilt packaging never rebuilds dist and restores config after exit %s', code => {
  mkdirSync('tmp', {recursive:true}); const root=mkdtempSync(resolve('tmp/vercel-package-'));
  try {
    const bin=join(root,'bin');mkdirSync(bin);
    const original='{"headers":[{"source":"/sw.js","headers":[]}],"buildCommand":"pnpm build"}\n';
    writeFileSync(join(root,'vercel.json'),original);
    mkdirSync(join(root,'dist/b/c'),{recursive:true});writeFileSync(join(root,'dist/b/c/main.js.map'),'map');
    const executable=join(bin,'vercel');
    writeFileSync(executable,`#!${process.execPath}\nimport fs from 'node:fs';const config=JSON.parse(fs.readFileSync('vercel.json'));if(config.buildCommand!=='node scripts/check-devserver.mjs dist'||config.installCommand!=='true'||config.outputDirectory!=='dist')process.exit(99);fs.writeFileSync('observed.json',JSON.stringify({config,args:process.argv.slice(2)}));fs.mkdirSync('.vercel/output/static/b/c',{recursive:true});fs.writeFileSync('.vercel/output/static/b/c/main.js','code');fs.writeFileSync('.vercel/output/static/b/c/main.js.map','map');process.exit(${code});\n`);
    chmodSync(executable,0o755);
    const result=spawnSync(process.execPath,[resolve('scripts/build-vercel-output.mjs')],{cwd:root,encoding:'utf8',
      env:{...process.env,PATH:`${bin}:${process.env['PATH'] ?? ''}`,VERCEL_BUILD_TOKEN:'fixture-token',WS_SENTRY_ENVIRONMENT:'none'}});
    expect(result.status,result.stderr).toBe(code);
    expect(readFileSync(join(root,'vercel.json'),'utf8')).toBe(original);
    const observed: {config:{headers:unknown[]};args:string[]}=JSON.parse(readFileSync(join(root,'observed.json'),'utf8'));
    expect(observed.config.headers).toEqual([{source:'/sw.js',headers:[]}]);
    expect(observed.args).toEqual(['build','--standalone','--prod','--scope','raynos-projects','--token','fixture-token']);
    // PAGE-SIZE PZ1: a packaged output drops its public maps; dist keeps the private copy. A failed build is left as it is.
    expect(existsSync(join(root,'.vercel/output/static/b/c/main.js.map'))).toBe(code !== 0);
    expect(existsSync(join(root,'.vercel/output/static/b/c/main.js'))).toBe(true);
    expect(existsSync(join(root,'dist/b/c/main.js.map'))).toBe(true);
    if (code === 0) expect(result.stdout).toContain('1 source maps (0.0 MB) kept out of .vercel/output/static');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('a release build sends its maps to the channel its release file names, and only then', () => {
  expect(sentryEnvironment({WILDSHARD_RELEASE_URL: 'https://packs.wildshard.io/releases/production.json'})).toBe('production');
  expect(sentryEnvironment({WILDSHARD_RELEASE_URL: 'https://packs.wildshard.io/releases/staging.json'})).toBe('staging');
  expect(sentryEnvironment({WILDSHARD_RELEASE_URL: 'http://127.0.0.1:9/releases/sitting.json'})).toBeUndefined();
  expect(sentryEnvironment({})).toBeUndefined();
  expect(sentryEnvironment({WS_SENTRY_ENVIRONMENT: 'preview'})).toBe('preview');
  expect(sentryEnvironment({WS_SENTRY_ENVIRONMENT: 'none', WILDSHARD_RELEASE_URL: 'https://x/releases/production.json'})).toBeUndefined();
  expect(() => sentryEnvironment({WS_SENTRY_ENVIRONMENT: 'prod'})).toThrow(/WS_SENTRY_ENVIRONMENT/u);
});
