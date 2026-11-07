// oxlint-disable-next-line import/no-nodejs-modules -- Own an isolated packaging workspace.
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the maintained CLI with a controlled Vercel executable.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve owned temporary paths.
import {join, resolve} from 'node:path';
import {expect, test} from 'vitest';

test.each([0, 7])('prebuilt packaging never rebuilds dist and restores config after exit %s', code => {
  mkdirSync('tmp', {recursive:true}); const root=mkdtempSync(resolve('tmp/vercel-package-'));
  try {
    const bin=join(root,'bin');mkdirSync(bin);
    const original='{"headers":[{"source":"/sw.js","headers":[]}],"buildCommand":"pnpm build"}\n';
    writeFileSync(join(root,'vercel.json'),original);
    const executable=join(bin,'vercel');
    writeFileSync(executable,`#!${process.execPath}\nimport fs from 'node:fs';const config=JSON.parse(fs.readFileSync('vercel.json'));if(config.buildCommand!=='node scripts/check-devserver.mjs dist'||config.installCommand!=='true'||config.outputDirectory!=='dist')process.exit(99);fs.writeFileSync('observed.json',JSON.stringify({config,args:process.argv.slice(2)}));process.exit(${code});\n`);
    chmodSync(executable,0o755);
    const result=spawnSync(process.execPath,[resolve('scripts/build-vercel-output.mjs')],{cwd:root,encoding:'utf8',
      env:{...process.env,PATH:`${bin}:${process.env['PATH'] ?? ''}`,VERCEL_BUILD_TOKEN:'fixture-token'}});
    expect(result.status,result.stderr).toBe(code);
    expect(readFileSync(join(root,'vercel.json'),'utf8')).toBe(original);
    const observed: {config:{headers:unknown[]};args:string[]}=JSON.parse(readFileSync(join(root,'observed.json'),'utf8'));
    expect(observed.config.headers).toEqual([{source:'/sw.js',headers:[]}]);
    expect(observed.args).toEqual(['build','--standalone','--prod','--scope','raynos-projects','--token','fixture-token']);
  } finally {rmSync(root,{recursive:true,force:true});}
});
