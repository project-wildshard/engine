// GR2: converted author programs do not load the legacy producer scheduler.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSync } from 'vite';
import { manifestFolders, outputManifest, builtShardFolders } from './shard-outputs.mjs';
import { usesProgramDiscovery } from './program-discovery.mjs';

/** The SDK's named, value-level generate export is the conversion boundary.
 * Never execute a config just to discover its build mode.
 * @param {string} source */
export function hasProjectGenerator(source) {
  const parsed = parseSync('shard.config.ts', source);
  if (parsed.errors.length > 0) throw new Error('Generation config does not parse');
  return parsed.program.body.some(node => {
    if (node.type !== 'ExportNamedDeclaration' || node.exportKind === 'type') return false;
    const own = node.declaration;
    return own?.type === 'VariableDeclaration' && own.declarations.some(row => row.id.type === 'Identifier' && row.id.name === 'generate')
      || own?.type === 'FunctionDeclaration' && own.id?.name === 'generate'
      || node.specifiers.some(row => row.exportKind !== 'type' && (row.exported.name ?? row.exported.value) === 'generate');
  });
}

/** @typedef {{products:string[],folders:string[],scoped:boolean}} GenerationPlan */
/** Resolve product slugs to source folders once.
 * Every current shard constructs its own source inputs; no scheduler catalogue is read.
 * @param {string} root @param {string} [requested] @returns {GenerationPlan} */
export function generationPlan(root, requested) {
  const directory = resolve(root, 'src/shards');
  const folders = readdirSync(directory, { withFileTypes: true }).filter(row => row.isDirectory()
    && existsSync(resolve(directory, row.name, 'shard.config.ts'))).map(row => row.name).sort();
  const products = builtShardFolders(root, folders);
  const selected = requested === undefined ? products.map(row => row.slug) : requested.split(',');
  if (selected.length === 0 || new Set(selected).size !== selected.length
    || selected.some(slug => !/^[a-z0-9_-]+$/u.test(slug) || !products.some(row => row.slug === slug))) throw new Error(`Generation unknown or duplicate shard: ${requested}`);
  const selectedFolders = [...new Set(products.filter(row => selected.includes(row.slug)).map(row => row.folder))];
  return { products: selected, folders: selectedFolders, scoped: requested !== undefined };
}

/** @param {string} root @param {GenerationPlan} plan @param {boolean} [reuse] */
export function buildPrograms(root, plan, reuse = false) {
  return Promise.reject(new Error(`Engine builds no shardfiles (${root}, ${plan.products.length}, ${reuse}): scripts/pins.ts installs them`));
}

/** Discovery and boot tables cover every manifest even for a scoped build.
 * Read declarations only; a config is never executed to discover prerequisites.
 * @param {string} root */
export function programDiscoveryFolders(root) {
  if (!existsSync(resolve(root, 'src/shards'))) return [];
  return builtShardFolders(root, manifestFolders(root)).filter(product => {
    const file = resolve(root, 'src/shards', product.folder, 'manifest.json');
    return existsSync(file) && usesProgramDiscovery(product.output === null
      ? JSON.parse(readFileSync(file, 'utf8')) : outputManifest(root, product.folder, product.output));
  }).map(product => product.slug);
}

/** Include global discovery prerequisites in legacy input preparation too.
 * @param {string} root @param {GenerationPlan} plan @returns {GenerationPlan} */
export function programInputPlan(root, plan) {
  if (!plan.scoped) return plan;
  const products = [...new Set([...plan.products, ...programDiscoveryFolders(root)])];
  return products.length === plan.products.length ? plan : generationPlan(root, products.join(','));
}

/** Build receipt-backed discovery inputs before their table consumers. An
 * inputs-only invocation builds only those required products; it never invents
 * placeholder values or treats an older receipt as current. With no program
 * bindings the previous tables-before-products order stays unchanged.
 * @param {string} root @param {GenerationPlan} plan
 * @param {{inputsOnly:boolean,reuse?:boolean,writeTables:()=>Promise<void>,build?:typeof buildPrograms}} options */
export async function emitProgramTables(root, plan, { inputsOnly, reuse = false, writeTables, build = buildPrograms }) {
  const required = programDiscoveryFolders(root);
  if (required.length > 0) {
    // Provider products can run headless validation before boot tables. Publish
    // the same installed physics bytes that the later boot stage already uses.
    const { copyRapierWasm } = await import('../vite/rapier.ts');
    copyRapierWasm(root);
    const products = inputsOnly ? generationPlan(root, required.join(',')) : programInputPlan(root, plan);
    await build(root, products, inputsOnly || reuse);
  }
  await writeTables();
  if (!inputsOnly && required.length === 0) await build(root, plan, reuse);
}
