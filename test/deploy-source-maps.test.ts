// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual deploy filesystem in owned tmp fixtures.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay under the repository's tmp directory.
import { dirname, join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare every retained runtime byte independently.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Qualify the exact Node CLI invoked by deployment.
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { stripDeploySourceMaps } from '../scripts/deploy-source-maps.mjs';
import deploy from '../.github/workflows/deploy.yml?raw';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });

function fixture() {
  mkdirSync('tmp',{recursive:true});
  const root = mkdtempSync(resolve('tmp/deploy-maps-')); roots.push(root);
  const dist = join(root,'dist'), artifact = join(root,'.vercel/output/static');
  const files = { 'index.html':'<script src="/assets/main.js"></script>', 'sw.js':'precache=["/assets/main.js"]',
    'assets/main.js':'export const value=4;', 'assets/main.js.map':'{"version":3,"sources":["main.ts"]}',
    'assets/worker.js.map.gz':'compressed map', 'assets/style.css':'body{margin:0}', 'shardfiles/home/blobs/mesh.bin':'\u0000\u0001\u0002',
    'shardfiles/home/minimap.json':'{"terrain":true}', '.vite/chunk-modules.json':'{"assets/main.js":{"moduleIds":["main.ts"]}}' };
  for (const [name,bytes] of Object.entries(files)) { const path=join(dist,name); mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes); }
  mkdirSync(dirname(artifact),{recursive:true});
  return {root,dist,artifact,files};
}

function inventory(root: string): Record<string,string> {
  const rows: Record<string,string> = {};
  const visit = (dir: string): void => {
    for (const name of readdirSync(join(root,dir))) {
      const relative=join(dir,name), path=join(root,relative);
      if (statSync(path).isDirectory()) visit(relative);
      else rows[relative]=createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  visit(''); return rows;
}

test.each(['copied','linked-root','linked-assets'] as const)('%s artifact omits maps without changing any runtime or original build bytes', kind => {
  const {dist,artifact,files}=fixture(), original=inventory(dist);
  if(kind==='linked-root')symlinkSync(dist,artifact,'dir');
  else {
    cpSync(dist,artifact,{recursive:true});
    if(kind==='linked-assets') {rmSync(join(artifact,'assets'),{recursive:true});symlinkSync(join(dist,'assets'),join(artifact,'assets'),'dir');}
  }
  const result=stripDeploySourceMaps(artifact);
  expect(result).toEqual({files:2,bytes:Buffer.byteLength(files['assets/main.js.map'])+Buffer.byteLength(files['assets/worker.js.map.gz'])});
  const expected={...original}; delete expected['assets/main.js.map'];delete expected['assets/worker.js.map.gz'];
  expect(inventory(artifact)).toEqual(expected); expect(inventory(dist)).toEqual(original);
  expect(stripDeploySourceMaps(artifact)).toEqual({files:0,bytes:0});
  expect(existsSync(join(dist,'assets/main.js.map'))).toBe(true);
});

test('the helper refuses an ordinary build directory before deleting diagnostic maps', () => {
  const {dist}=fixture(), before=inventory(dist);
  expect(()=>stripDeploySourceMaps(dist)).toThrow('Vercel .vercel/output/static');
  expect(inventory(dist)).toEqual(before);
});

test('the workflow CLI remains standalone after checking out a historical release pin', () => {
  const {root,dist,artifact}=fixture(); cpSync(dist,artifact,{recursive:true});
  const helper=join(root,'current-tools/deploy-source-maps.mjs');mkdirSync(dirname(helper),{recursive:true});
  cpSync(resolve('scripts/deploy-source-maps.mjs'),helper);
  const child=spawnSync(process.execPath,[helper,artifact],{encoding:'utf8',cwd:root});
  expect(child.status,child.stderr).toBe(0);
  const result: unknown=JSON.parse(child.stdout);
  expect(result).toMatchObject({files:2});expect(existsSync(join(artifact,'assets/main.js.map'))).toBe(false);
  expect(existsSync(join(dist,'assets/main.js.map'))).toBe(true);
});

test('deployment archives build maps before stripping only the public artifact', () => {
  const archive=deploy.indexOf('name: Retain production source maps privately');
  const strip=deploy.indexOf('node "$RUNNER_TEMP/deploy-source-maps.mjs" .vercel/output/static');
  const upload=deploy.indexOf('url=$(vercel deploy --prebuilt');
  expect(archive).toBeGreaterThan(0); expect(strip).toBeGreaterThan(archive);expect(upload).toBeGreaterThan(strip);
  expect(deploy.slice(archive,strip)).toContain('dist/**/*.map');
  const beforePin=deploy.split('      - name: Read the deploy pin')[1]?.split('      - name: Check out the pin')[0];
  expect(beforePin).toContain('cp scripts/deploy-pin.mjs scripts/deploy-version.mjs scripts/deploy-source-maps.mjs scripts/prebuilt-output.py scripts/staged-deployment.py "$RUNNER_TEMP/"');
});
