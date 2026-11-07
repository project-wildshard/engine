import { productManifestPath } from './authored-manifest.mjs';
import { shardProducts } from './shard-outputs.mjs';
// G14: computed manifest limits are generated separately from lead-approved GL measurements.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Refresh computed entries only; never touch measured ceilings, captures or approvals. */
export async function genBudgetDerivations(root = resolve(import.meta.dirname, '..'), check = false, shard = '') {
  const folders = readdirSync(resolve(root, 'src/shards'), { withFileTypes: true }).filter((entry) => entry.isDirectory() && (existsSync(resolve(root, 'src/shards', entry.name, 'manifest.ts')) || existsSync(resolve(root, 'src/shards', entry.name, 'manifest.json')))).map((entry) => entry.name).sort();
  const products = shardProducts(root, folders), slugs = products.map((row) => row.slug);
  if (shard && (!/^[a-z0-9_-]+$/.test(shard) || !slugs.includes(shard))) throw new Error(`gen-budgets: unknown shard ${shard}`);
  const file = resolve(root, 'budgets/ceiling-sources.json');
  if (!existsSync(file)) throw new Error('gen-budgets: missing budgets/ceiling-sources.json; the lead must seed measured provenance first');
  const before = readFileSync(file, 'utf8'), data = JSON.parse(before);
  if (!data.derived || typeof data.derived !== 'object' || Array.isArray(data.derived)) throw new Error('gen-budgets: invalid derived entries');
  await import('./bake-loader.mjs');
  const { deriveBudget } = await import('../src/client/engine/render/budgets.ts');
  const { parseCalibration } = await import('../src/client/engine/render/calibration.ts');
  const raw = readFileSync(resolve(root, 'budgets/calibration.json'), 'utf8'), calibration = parseCalibration(raw);
  const digest = createHash('sha256').update(raw).digest('hex');
  // A shard lane cannot silently reinterpret the rest of the file against another calibration.
  if (shard && (data.calibration !== calibration.measuredAt || data.calibrationSha256 !== digest)) throw new Error('gen-budgets: calibration changed; the lead must run unscoped pnpm gen');
  const derived = shard ? { ...data.derived } : {};
  for (const slug of shard ? [shard] : slugs) {
    const product = products.find((row) => row.slug === slug);
    if (product === undefined) throw new Error(`gen-budgets: unknown shard ${slug}`);
    const { default: manifest } = await import(pathToFileURL(resolve(root, productManifestPath(root, product))).href);
    const inputs = manifest.budgets ?? {};
    derived[slug] = Object.fromEntries(['phone', 'desktop'].map((tier) => [tier, deriveBudget({ phone: inputs.phone, desktop: inputs.desktop, load: inputs.load }, tier === 'phone' ? 'phone' : 'desktop', calibration)]));
  }
  data.derived = derived;
  if (!shard) { data.calibration = calibration.measuredAt; data.calibrationSha256 = digest; }
  const source = `${JSON.stringify(data, null, 2)}\n`;
  if (check && source !== before) throw new Error(`gen-budgets: stale budgets/ceiling-sources.json (run pnpm gen${shard ? ` --shard=${shard}` : ''})`);
  if (!check && source !== before) writeFileSync(file, source);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { await genBudgetDerivations(process.argv.find((arg) => arg.startsWith('--root='))?.slice(7), process.argv.includes('--check'), process.argv.find((arg) => arg.startsWith('--shard='))?.slice(8)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
