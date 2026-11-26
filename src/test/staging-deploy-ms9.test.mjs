import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, test, vi } from 'vitest';
import { CHANNELS, QA_LEGS } from '../scripts/page-release/flow.mjs';
import { deployStaging, toolsRoot } from '../scripts/page-release/staging-deploy.mjs';
import { LEGS } from '../scripts/staging-qa-budget.mjs';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original(), spawn }));
vi.mock('../../src/scripts/server-release/sign.mjs', () => ({ readPublication: JSON.parse }));

test('staging moves a qualified alias when rooms have switched and MS9 has no witness', async () => {
  const root = mkdtempSync('tmp/staging-ms9-');
  const out = join(root, 'delivery');
  const build = 'a'.repeat(40), source = 'b'.repeat(40), release = 'v0.1.65';
  const { origin } = CHANNELS.staging;
  const ran = ids => ids.map(id => ({ id, status: 'ran' }));
  const base = { qa: true, full: true, release, hold: false };
  const childOutputs = [];
  spawn.mockImplementation((_file, args) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), exitCode: null });
    queueMicrotask(() => {
      const qualification = args.includes('--deploy-checks');
      const kind = qualification ? 'candidate' : 'staging';
      const tour = args.some(arg => arg.endsWith('/zone-entry-tour.mjs'));
      const dir = tour
        ? args.find(arg => arg.startsWith('--out=')).slice('--out='.length)
        : args[args.indexOf('--out') + 1];
      childOutputs.push(dir);
      mkdirSync(dir, { recursive: true });
      const proof = tour ? {
        build, engine: 'webkit', profile: 'phone', pass: true, expected: 2,
        arrivals: [
          { from: 'driftwood-isle', to: 'far-reach' },
          { from: 'far-reach', to: 'driftwood-isle' },
        ],
      } : { ...base, build, kind, url: origin, scenarios: ran(QA_LEGS[kind]) };
      writeFileSync(join(dir, tour ? 'zone-entry.json' : 'verdict.json'), JSON.stringify(proof));
      child.stdout.end();
      child.exitCode = 0;
      child.emit('close', 0);
    });
    return child;
  });
  const phase = vi.fn(async () => undefined);
  try {
    await deployStaging({
      root, out, build, source, release, phase, log: vi.fn(),
      localQa: { ...base, kind: 'local', build: source, url: 'http://localhost:4400', scenarios: ran(LEGS.local) },
      readState: () => ({ upload: {}, check: { deployment: { url: 'https://candidate.example' }, serial: 131 } }),
      get: async url => url === CHANNELS.staging.release ? { engineBuild: build } : { build: source },
    });
    expect(phase).toHaveBeenCalledExactlyOnceWith('go-live', expect.objectContaining({ kind: 'candidate', build }));
    const verdict = JSON.parse(readFileSync(join(out, 'verdict.json'), 'utf8'));
    expect(verdict).toMatchObject({ status: 'pass', hold: false, aliasMoved: true });
    expect(verdict.findings).toEqual([expect.objectContaining({ key: 'rooms-already-switched', severity: 'P2' })]);
    expect(JSON.parse(readFileSync(join(out, 'qualification', 'leg.json'), 'utf8'))).toMatchObject({ build, kind: 'candidate' });
    expect(JSON.parse(readFileSync(join(out, 'live', 'leg.json'), 'utf8'))).toMatchObject({ build, kind: 'staging' });
    expect(JSON.parse(readFileSync(join(out, 'zone-entry', 'zone-entry.json'), 'utf8'))).toMatchObject({ build, pass: true });
    expect(childOutputs).toHaveLength(3);
    expect(childOutputs.some(dir => existsSync(dir))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// v0.1.94: after the lean move the deploy's scratch, observer and QA jobs ran from src/, and its src/tmp/ dirtied the
// release clone mid go-live, so the page upload refused it.
test('the staging deploy runs its jobs and scratch from the repository root, whose tmp/ git ignores', () => {
  expect(existsSync(join(toolsRoot, 'package.json'))).toBe(true);
  expect(existsSync(join(toolsRoot, 'src', 'scripts', 'page-release', 'staging-deploy.mjs'))).toBe(true);
  expect(readFileSync(join(toolsRoot, '.gitignore'), 'utf8')).toMatch(/^\/?tmp\/?$/mu);
});
