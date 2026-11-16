#!/usr/bin/env node
// E357 S1.6: run after F2 recordings land and after each accepted calibration.
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { baselineCeilings } from './parity/budgetCeilings.mjs';
import { shardFolders } from './shard-folders.mjs';
import { folderManifestPath } from './authored-manifest.mjs';
import { builtShardFolders } from './shard-outputs.mjs';
import { keptBudgets } from './budget-ratchet.mjs';

await import('./bake-loader.mjs');
const { deriveBudget } = await import('../src/client/engine/render/budgets');
const { parseCalibration } = await import('../src/client/engine/render/calibration');
/** @type {Record<string, string | undefined>} */
const options = Object.fromEntries(process.argv.slice(2).map((s) => { const m = /^--(root|lanes|reports|accept)=(.+)$/.exec(s); if (!m) throw new Error(`Unknown argument ${s}`); return [m[1], m[2]]; }));
const root = resolve(options.root ?? join(import.meta.dirname, '..')), lanes = (options.lanes ?? 'm5,gh-macos15').split(','), records = [], provenance = [];
for (const lane of lanes) {
  const dir = join(root, 'test/parity/baselines', lane);
  if (!existsSync(dir)) throw new Error(`Missing baseline lane ${lane}; pass --lanes=m5 to explicitly seed the available lane`);
  for (const file of readdirSync(dir).filter((name) => /\.(phone|desktop)\.json$/.test(name))) {
    const path = join(dir, file), record = JSON.parse(readFileSync(path, 'utf8')); records.push(record); provenance.push({ file: `test/parity/baselines/${lane}/${file}`, sha: record.sha, recorded: record.recorded });
  }
}
// Supplemental captures measure the free-camera D absent from pre-S1.6 standing-pose baselines.
if (options.reports) for (const file of readdirSync(options.reports).filter((name) => /\.(phone|desktop)\.json$/.test(name))) {
  const path = join(options.reports, file), report = JSON.parse(readFileSync(path, 'utf8'));
  records.push(report); provenance.push({ file: path, sha: report.sha ?? report.boot?.sha, recorded: report.recorded ?? null });
}
const measured = baselineCeilings(records), ratchetPath = join(root, 'lint/ratchet.json'), ratchet = JSON.parse(readFileSync(ratchetPath, 'utf8'));
const current = join(root, 'budgets/calibration.json'), calibration = existsSync(current) ? parseCalibration(readFileSync(current, 'utf8')) : null;
const specs = new Map();
for (const product of builtShardFolders(root, shardFolders(root))) { const { default: manifest } = await import(join(root, folderManifestPath(root, product))); specs.set(product.slug, manifest.budgets ?? {}); }
const next = { ...ratchet.budgets };
for (const [slug, inputs] of specs) for (const [tier, poses] of Object.entries(inputs.ceilings ?? {})) for (const [pose, limits] of Object.entries(poses)) for (const [metric, ceiling] of Object.entries(limits)) {
  const key = `${slug}.${tier}.${pose}.${metric}`; next[key] = Math.min(next[key] ?? ceiling, ceiling);
}
for (const [key, ceiling] of Object.entries(measured)) {
  const [slug, tier, , metric] = key.split('.'), inputs = specs.get(slug);
  if ((tier !== 'phone' && tier !== 'desktop') || (metric !== 'draws' && metric !== 'tris' && metric !== 'programs' && metric !== 'gpuMB')) throw new Error(`Invalid budget key ${key}`);
  const target = calibration && inputs ? deriveBudget(inputs, tier, calibration)?.limits[metric] : null;
  if (target !== null && target !== undefined && Math.min(next[key] ?? ceiling, ceiling) <= target) { delete next[key]; continue; }
  next[key] = Math.min(next[key] ?? ceiling, ceiling);
}
// Only an explicit, provenance-bearing acceptance can replace a GL-byte ceiling.
// Values are extracted from its captured report, never entered in the approval document.
const reRecords = [];
if (options.accept) {
  const approval = JSON.parse(readFileSync(resolve(root, options.accept), 'utf8'));
  if (!approval.ask || !approval.approvedBy || !approval.approval || !Array.isArray(approval.entries)) throw new Error('Re-record approval needs ask, owner, approval text and entries');
  for (const entry of approval.entries) {
    if (!specs.has(entry.shard) || !['phone', 'desktop'].includes(entry.tier) || entry.metric !== 'gpuMB' || !/^[a-f0-9]{40}$/.test(entry.commit) || !entry.reason || !entry.source) throw new Error('Invalid GL re-record approval');
    const path = resolve(root, entry.source), raw = readFileSync(path, 'utf8'), capture = JSON.parse(raw);
    if (capture.boot?.shard !== entry.shard || capture.boot?.tier !== entry.tier || capture.boot?.errors?.length !== 0) throw new Error('Re-record source must be a matching clean boot');
    const ceilings = Object.fromEntries(Object.entries(baselineCeilings([capture])).filter(([key]) => key.endsWith('.gpuMB')));
    if (Object.keys(ceilings).length === 0) throw new Error('Re-record source has no measured GL bytes');
    Object.assign(next, ceilings);
    reRecords.push({ ...entry, ask: approval.ask, approvedBy: approval.approvedBy, approval: approval.approval, captureSha: capture.sha ?? capture.boot.sha, captureSha256: createHash('sha256').update(raw).digest('hex'), ceilings });
  }
}
// Owning manifests import these data files; no renderer or cross-shard imports enter the manifests.
for (const slug of specs.keys()) {
  /** @type {Record<'phone' | 'desktop', Record<string, Record<string, number>>>} */
  const ceilings = { phone: {}, desktop: {} };
  for (const [key, ceiling] of Object.entries(next)) {
    const [id, tier, pose, metric] = key.split('.');
    if (id !== slug) continue;
    if ((tier !== 'phone' && tier !== 'desktop') || !pose || !metric) throw new Error(`Invalid budget key ${key}`);
    (ceilings[tier][pose] ??= {})[metric] = ceiling;
  }
  // A shard whose budgets are data (lint/shard-layout.json dataHomes) keeps its ceilings there as pure JSON data: no engine
  // type import, which would pull data/ out of the public share; the manifest's BudgetInputs type checks the shape.
  const doc = '/** Measured rollout maxima; count targets rederive after calibration; provenance: budgets/ceiling-sources.json. */';
  const budgetFile = join(root, 'src/shards', slug, 'data/budgets.json');
  if (existsSync(budgetFile)) {
    const budget = JSON.parse(readFileSync(budgetFile, 'utf8'));
    writeFileSync(budgetFile, `${JSON.stringify({ ...budget, ceilings }, null, 2)}\n`);
  } else if (existsSync(join(root, 'src/shards', slug, 'data/budgetCeilings.json'))) writeFileSync(join(root, 'src/shards', slug, 'data/budgetCeilings.json'), `${JSON.stringify(ceilings, null, 2)}\n`);
  else if (existsSync(join(root, 'src/shards', slug, 'data/budgetCeilings.ts'))) writeFileSync(join(root, 'src/shards', slug, 'data/budgetCeilings.ts'), `${doc}\nexport const BUDGET_CEILINGS = ${JSON.stringify(ceilings, null, 2)};\n`);
  else writeFileSync(join(root, 'src/shards', slug, 'budgetCeilings.ts'), `import type { LevelSpec } from '@wildshard/engine/level/spec';\n\n${doc}\nexport const BUDGET_CEILINGS = ${JSON.stringify(ceilings, null, 2)} satisfies NonNullable<LevelSpec['budgets']['ceilings']>;\n`);
}
// Manifest data now owns every rollout ceiling; the legacy fallback must not duplicate it. The ratchet's other budgets
// (js/* chunk ceilings) stay.
ratchet.budgets = keptBudgets(ratchet.budgets);
writeFileSync(ratchetPath, `${JSON.stringify(ratchet, null, 2)}\n`);
mkdirSync(join(root, 'budgets'), { recursive: true });
writeFileSync(join(root, 'budgets/ceiling-sources.json'), `${JSON.stringify({ source: 'F2 max(lanes) plus recorded parity band; ceilings only decrease except explicit provenance-bearing GL re-records', lanes, calibration: calibration?.measuredAt ?? null, calibrationSha256: calibration ? createHash('sha256').update(readFileSync(current)).digest('hex') : null, derived: Object.fromEntries([...specs].map(([slug, inputs]) => [slug, Object.fromEntries(['phone', 'desktop'].map((tier) => [tier, calibration ? deriveBudget({ phone: inputs.phone, desktop: inputs.desktop, load: inputs.load }, tier === 'phone' ? 'phone' : 'desktop', calibration) : null]))])), baselines: provenance, reRecords }, null, 2)}\n`);
console.info(`Seeded/lowered ${Object.keys(measured).length} budget measurements from ${records.length} baselines. Run node lint/ratchet.mjs; commit budgets and provenance by private index if ratchet has other WIP.`);
