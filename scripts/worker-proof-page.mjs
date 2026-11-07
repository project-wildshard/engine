#!/usr/bin/env node
// J130: a built page that boots the Developer row by itself, for a phone with no Settings step. Copies a build to its own folder
// and seeds the two device keys before anything reads them, in that copy only: no shipped build carries this. Deploy the folder
// to the proof's own Vercel project, whose origin keeps its saves apart from the real game's. The flip deletes this with the row.
//   node scripts/worker-proof-page.mjs --dist=<built dir> --out=tmp/worker-proof/deploy
//   (cd tmp/worker-proof/deploy && vercel deploy --prod --yes --scope raynos-projects)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { saveFixtureCode } from './debug-settings.mjs';

const ROOT = resolve(import.meta.dirname, '..'), TEAM = 'team_HPUh311dFa6AoKlBNtS9Oiph', PROJECT = 'prj_5DrKub80ZiMcjDNtlICOpUuZmPwD';
const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const dist = arg('dist'), out = arg('out');
if (dist === undefined || out === undefined) throw new Error('Requires --dist and --out');

rmSync(out, { recursive: true, force: true }); mkdirSync(dirname(out), { recursive: true });
execFileSync('cp', ['-cR', dist, out]); // APFS clones: a build is 2.8 GB, and most of it never changes
for (const file of ['trailer-15.mp4', 'trailer-30.mp4', '.vite']) rmSync(join(out, file), { recursive: true, force: true }); // no phone proof reads them
const seeds = [{ scope: 'device', key: 'devMode', data: true }].map(saveFixtureCode).join(';');
const page = join(out, 'index.html'), html = readFileSync(page, 'utf8');
if (!html.includes('<head>')) throw new Error('A build page has no head');
writeFileSync(page, html.replace('<head>', `<head><script>${seeds}</script>`));
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
delete vercel.buildCommand;
writeFileSync(join(out, 'vercel.json'), `${JSON.stringify({ ...vercel, framework: null }, null, 1)}\n`);
mkdirSync(join(out, '.vercel'), { recursive: true });
writeFileSync(join(out, '.vercel/project.json'), JSON.stringify({ projectId: PROJECT, orgId: TEAM, projectName: 'wildshard-worker-proof' }));
console.log(JSON.stringify({ out, build: JSON.parse(readFileSync(join(out, 'version.json'), 'utf8')).build }));
