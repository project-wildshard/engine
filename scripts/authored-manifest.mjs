import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { authoredManifestImports } from './manifest-static-imports.mjs';
import { generatedSourcePolicy, GENERATED_SOURCE_POLICY } from './generated-source.mjs';

/** Existing reviewed source outputs may remain there; every new discovery is a build product. */
function discoveryPath(root, folder, file) {
  const source = `src/shards/${folder}/${file}`, policy = resolve(root, GENERATED_SOURCE_POLICY);
  if (existsSync(policy) && generatedSourcePolicy(JSON.parse(readFileSync(policy, 'utf8'))).files.includes(source)) return source;
  const importPolicy = resolve(root, 'lint/generated-import-debt.json');
  if (existsSync(importPolicy)) {
    const value = JSON.parse(readFileSync(importPolicy, 'utf8'));
    const sources = value.sources ?? [];
    if (value.schema !== 'no-generated-import/1' || !Array.isArray(sources) || sources.some(path => typeof path !== 'string')) throw new Error('Invalid discovery source placement policy');
    if (sources.includes(source)) return source;
  }
  return `out/.app/discovery.${folder}${file.slice('discovery'.length)}`;
}

export function shardManifestPath(root, slug) {
  return existsSync(resolve(root, `src/shards/${slug}/manifest.json`)) ? discoveryPath(root, slug, 'discovery.generated.ts') : `src/shards/${slug}/manifest.ts`;
}
/** A product's discovery module: its folder's, or one per declared output (SF88g, scripts/shard-outputs.mjs). */
export function productManifestPath(root, product) {
  return product.output === null ? shardManifestPath(root, product.slug) : discoveryPath(root, product.folder, `discovery.${product.slug}.generated.ts`);
}
/** Literal imports keep authored image strings inside the bundler's asset graph. An output of a source folder (SF88g) passes
 * its `composed` manifest (scripts/shard-outputs.mjs outputManifest), so this module, which generation jobs load from
 * their isolated exports, imports nothing more.
 * metadataOnly emits the identical TypeScript table for a source type check;
 * asset presence remains the ordinary build's responsibility.
 * @param {string} root @param {string} slug @param {{ generation?: boolean, metadataOnly?: boolean, folder?: string, composed?: Record<string, unknown> | null, discovery?: import('@wildshard/format/discoveryValues').DiscoveryValues }} [options] */
export function authoredManifestSource(root, slug, { generation = false, metadataOnly = false, folder = slug, composed = null, discovery } = {}) {
  const file = composed === null ? `src/shards/${folder}/manifest.json` : `src/shards/${folder}/outputs.json#${slug}`;
  if (existsSync(resolve(root, `src/shards/${folder}/manifest.ts`))) throw new Error(`${file}: duplicate authored manifest authority`);
  const data = composed ?? JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  if (data.slug !== slug) throw new Error(`${file}: identity differs from its folder`);
  if (Object.hasOwn(data, 'runtimeEntry')) throw new Error(`${file}: client-plan entry names no runtime module`);
  const dataMap = resolve(root, `src/shards/${folder}/data/map.json`);
  const mapPath = existsSync(dataMap) ? dataMap : resolve(root, `src/shards/${folder}/look/map.json`);
  const mapPainter = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, 'utf8')).painter : undefined;
  // Geometry producers run before the map they feed. Only their discovery
  // compilation may defer this one declared output; final discovery checks it.
  const generatedMap = mapPainter?.program === true || generation && mapPainter?.version === 1
    ? `/assets/${slug}/map/top.webp` : undefined;
  const images = new Set();
  const visit = value => {
    if (typeof value === 'string' && value.startsWith('/src/')) {
      if (!value.startsWith(`/src/shards/${folder}/`) || !/^\/src\/shards\/[a-z0-9_-]+\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp|svg|hdr)$/u.test(value) || value.includes('..') || (!metadataOnly && !existsSync(resolve(root, value.slice(1))))) throw new Error(`${file}: missing or invalid source image ${value}`);
      images.add(value);
    } else if (!metadataOnly && typeof value === 'string' && value.startsWith('/assets/') && value !== generatedMap && !existsSync(resolve(root, 'public', value.slice(1).split('?')[0]))) throw new Error(`${file}: missing public image ${value}`);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const value of [data.card, data.sky, data.minimap, data.explore, data.horizonStrips]) visit(value);
  const imports = [], bound = new Map();
  // The current-product reader admits these detached values before emission.
  const supplied = discovery;
  const program = (ref, key) => {
    if (Object.keys(ref).length !== 1 || supplied === undefined || !Object.hasOwn(supplied, key)) throw new Error(`${file}: missing or invalid program discovery value ${key}`);
    return supplied[key];
  };
  const localPath = value => {
    if (typeof value !== 'string' || !/^\.\/[a-zA-Z0-9_./-]+$/u.test(value) || value.split('/').includes('..')) throw new Error(`${file}: invalid binding module`);
    const candidates = [value, `${value}.ts`, `${value}.js`, `${value}/index.ts`];
    if (metadataOnly && value.endsWith('.json')) candidates.push(value.replace(/\.json$/u, '.d.json.ts'));
    if (!metadataOnly && !candidates.some(path => existsSync(resolve(root, `src/shards/${folder}`, path)))) throw new Error(`${file}: unknown binding module ${value}`);
    return value;
  };
  const modulePath = value => {
    if (typeof value !== 'string' || !/^\.\/[a-zA-Z0-9_-]+(?:[./][a-zA-Z0-9_-]+)*\.(?:json|generated)$/u.test(value)) throw new Error(`${file}: binding requires a JSON or generated module`);
    return localPath(value);
  };
  const value = (ref, bindingKey) => {
    if (ref?.program === true) return JSON.stringify(program(ref, bindingKey));
    const path = modulePath(ref?.module), name = ref?.export;
    if (typeof name !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/u.test(name)) throw new Error(`${file}: invalid binding export`);
    const key = JSON.stringify([path, name]);
    if (bound.has(key)) return bound.get(key);
    const id = `binding${bound.size}`;
    if (path.endsWith('.json')) {
      imports.push(`import ${id} from ${JSON.stringify(path)} with { type: 'json' };`);
      if (name !== 'default') throw new Error(`${file}: JSON bindings name their default export`);
    } else imports.push(`import { ${name} as ${id} } from ${JSON.stringify(path)};`);
    bound.set(key, id);return id;
  };
  const lazy = (ref, call) => {
    if (typeof ref.export !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/u.test(ref.export)) throw new Error(`${file}: invalid lazy binding export`);
    return `(await import(${JSON.stringify(modulePath(ref.module))}))[${JSON.stringify(ref.export)}]${call ? '()' : ''}`;
  };
  const b = data.bindings;
  if (!b || typeof b.accent !== 'string') throw new Error(`${file}: missing binding declarations`);
  if (b.boot?.explore) {
    const ref = b.boot.explore, path = ref.program === true ? undefined : modulePath(ref.module);
    if (path !== undefined && (!path.endsWith('.json') || ref.export !== 'default')) throw new Error(`${file}: boot explore requires default JSON rows`);
    const absolute = path === undefined ? undefined : resolve(root, `src/shards/${folder}`, path);
    if (absolute === undefined || !metadataOnly || existsSync(absolute)) {
      const rows = absolute === undefined ? program(ref, 'boot.explore') : JSON.parse(readFileSync(absolute, 'utf8'));
      if (rows === null || typeof rows !== 'object' || Object.keys(rows).length !== 1 || !Array.isArray(rows.art) || rows.art.length > 256 || rows.art.some(image => typeof image !== 'string' || !/^(?:\/src\/|\/assets\/|data:image\/)/u.test(image))) throw new Error(`${file}: invalid boot explore art`);
      visit(rows.art);
    }
  }
  const paths = [...images];
  // Build-only budget bindings become checked literals. Generated runtime discovery
  // never imports data/. Remove this bridge with catalog activation (P3).
  const budgetPath = b.budgets?.program === true ? '' : modulePath(b.budgets?.module);
  if (budgetPath.endsWith('.json') && b.budgets.export !== 'default') throw new Error(`${file}: JSON bindings name their default export`);
  const budget = b.budgets?.program === true ? value(b.budgets, 'budgets')
    : metadataOnly && budgetPath.endsWith('.json') && !existsSync(resolve(root, `src/shards/${folder}`, budgetPath)) ? value(b.budgets)
    : budgetPath.endsWith('.json')
    ? JSON.stringify(JSON.parse(readFileSync(resolve(root, `src/shards/${folder}`, budgetPath), 'utf8')))
    : budgetPath.startsWith('./data/')
    ? execFileSync(process.execPath, [resolve(import.meta.dirname, 'manifest-budget.mjs'), resolve(root, `src/shards/${folder}`, budgetPath.endsWith('.ts') ? budgetPath : `${budgetPath}.ts`), b.budgets.export], { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 65_536 }).trim()
    : value(b.budgets);
  const rows = [`accent: ${JSON.stringify(b.accent)}`, `budgets: ${budget}`];
  // G4: declared rows are built by the game from the shard's generated file, with no shard module
  const DECLARED = { ground: 'declaredGround', forestQueries: 'declaredForestQueries', pondClip: 'declaredPondClip' };
  const declared = Object.keys(DECLARED).filter(key => key !== 'forestQueries' && b[key]?.platform === 'declared' || key === 'forestQueries' && b[key]?.platform === 'fixed');
  const built = (key) => `${DECLARED[key]}(${value(b[key].rows, `${key}.rows`)})`;
  for (const key of ['runtimeCost', 'mapPalette', 'poses', 'forestQueries', 'pondClip', 'groundRows', 'groundColourSamples', 'surfaceSamples', 'forestMaskSamples', 'mapGroundSamples', 'navmesh']) if (b[key]) {
    if (key === 'forestQueries' && b[key].platform === 'fixed') { rows.push(`forestQueries: declaredForestQueries(${JSON.stringify(b[key])})`); continue; }
    if (key === 'forestQueries' && b[key].platform === 'declared') { rows.push(`forestRows: ${value(b[key].rows, 'forestQueries.rows')}`); continue; }
    if (declared.includes(key)) { rows.push(`${key}: ${built(key)}`); continue; }
    // Fixed palette JSON becomes a contextually checked literal, preserving tuple
    // arity without importing an executable coordinate recipe into discovery.
    const palette = key === 'mapPalette' && b[key].program !== true && modulePath(b[key].module).endsWith('.json') && (!metadataOnly || existsSync(resolve(root, `src/shards/${folder}`, b[key].module)));
    if (palette && b[key].export !== 'default') throw new Error(`${file}: JSON bindings name their default export`);
    rows.push(`${key}: ${palette ? JSON.stringify(JSON.parse(readFileSync(resolve(root, `src/shards/${folder}`, b[key].module), 'utf8'))) : value(b[key], key)}`);
  }
  if (b.spawns) {
    // a generator's export runs below (manifest-spawns.mjs); any other module is a JSON or generated one
    const generator = typeof b.spawns.module === 'string' && b.spawns.module.startsWith('./generators/');
    const path = generator ? localPath(b.spawns.module) : modulePath(b.spawns.module);
    const spawns = path.startsWith('./generators/')
      ? execFileSync(process.execPath, [resolve(import.meta.dirname, 'manifest-spawns.mjs'), resolve(root, `src/shards/${folder}`, path.endsWith('.ts') ? path : `${path}.ts`), b.spawns.export], { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 65_536 }).trim()
      : value(b.spawns);
    rows.push(`spawns: ${spawns}`);
  }
  if (b.navigation) { const id = value(b.navigation, 'navigation'), ref = b.navigation.program === true ? `(${id})` : id;rows.push(`navigation: { row: ${ref}.navigation, url: ${ref}.url }`); }
  if (b.audioCues || b.audioPreload) rows.push(`audioBindings: { ${[...(b.audioCues ? [`cues: ${value(b.audioCues, 'audioCues')}`] : []), ...(b.audioPreload ? [`preload: async () => ${lazy(b.audioPreload, true)}`] : [])].join(', ')} }`);
  if (b.sword?.platform === 'graph') {
    rows.push(`sword: async () => (await (await import('@wildshard/engine/game/systems/viewmodel/heldView')).HeldView.fromProduct(${JSON.stringify(slug)}, ${JSON.stringify(b.sword.file)})).sword()`);
  } else if (b.sword?.rows) {
    const heldRows = value({ module: b.sword.rows, export: 'default' });
    rows.push(`sword: async () => (await import('@wildshard/engine/game/systems/viewmodel/heldView')).HeldView.admit({ kind: 'toon', ...${heldRows}.look }).sword()`);
  } else if (b.sword) rows.push(`sword: async () => ${lazy(b.sword, true)}`);
  if (b.boot?.platform === 'page-mode') {
    imports.push(`import { ${b.ktx2?.platform === 'page-mode' ? 'pageModeBoot, pageModeKtx2' : 'pageModeBoot'} } from '@wildshard/engine/game/shard/pageBoot';`);
    rows.push(`bootBindings: pageModeBoot(${value(b.boot.rows, 'boot.pageModes')})`);
  } else if (b.boot) rows.push(`bootBindings: { ${['files', 'sources', 'lateReads', 'bakedUnread', 'audio', 'explore'].filter(key => b.boot[key]).map(key => key === 'audio' ? `audio: async () => ${lazy(b.boot[key], true)}` : `${key}: ${value(b.boot[key], `boot.${key}`)}`).join(', ')} }`);
  const native = [];
  if (b.render?.platform === 'toon') native.push("render: async (product) => (await import('@wildshard/engine/game/looks/toonLook')).toonLook(product)");
  if (declared.includes('ground')) native.push(`ground: { ...${built('ground')}, ...${JSON.stringify(data.ground ?? {})} }`);
  else if (b.ground) native.push(`ground: ${value(b.ground)}`);
  if (b.render?.platform === 'painted') native.push("render: async (product) => (await import('@wildshard/engine/game/looks/paintedLook')).productPaintedLook(product)");
  if (b.render?.platform === 'keyed') native.push(`render: async (product) => (await import('@wildshard/engine/game/looks/keyedSky')).keyedSkyRender(product, { channels: ${JSON.stringify(b.render.channels)}, looks: ${value(b.render.looks)}, trim: ${value(b.render.trim)}[${JSON.stringify(b.render.trimRow)}] })`);
  if (b.render?.platform === 'post') native.push(`render: async (product) => (await import('@wildshard/engine/game/looks/postGraphLook')).postGraphLook(product, { file: ${JSON.stringify(b.render.file)}, field: ${JSON.stringify(b.render.field)} })`);
  if (b.roster?.platform === 'held') native.push(`roster: async () => (await import('@wildshard/engine/game/models/heldGear')).heldArmsGear(${value({ module: b.roster.rows, export: 'default' })})`);
  for (const key of ['render', 'roster']) if (b[key] && b[key].platform === undefined) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/u.test(b[key].export)) throw new Error(`${file}: invalid lazy binding export`);
    // a called look or roster factory gets the shard's product (toLevelSpec binds it; product-in-look-o272)
    native.push(key === 'render' || b[key].call === true ? `${key}: async (product) => callWithProduct(${lazy(b[key], false)}, product)` : `${key}: async () => ${lazy(b[key], false)}`);
  }
  if (b.entry) {
    if (b.load) throw new Error(`${file}: entry and load are mutually exclusive`);
    if (b.entry.platform !== 'client-plan' || ['legacy', 'native', 'nativePlan'].some(key => Object.hasOwn(b.entry, key))) throw new Error(`${file}: client-plan entry names no runtime module`);
    if (typeof b.entry.retainHomeRuntime !== 'boolean' || !['declared', 'runtime'].includes(b.entry.stagesOwner)) throw new Error(`${file}: invalid entry ownership`);
    const styles = b.entry.styles ?? [];
    if (!Array.isArray(styles) || styles.length > 8 || new Set(styles).size !== styles.length) throw new Error(`${file}: invalid entry styles`);
    const styleImports = styles.map(style => { const path = localPath(style); if (!path.endsWith('.css')) throw new Error(`${file}: entry style must be CSS`); return `import(${JSON.stringify(path)})`; });
    const prepareStyles = styleImports.length === 0 ? '' : `await Promise.all([${styleImports.join(', ')}]); `;
    const policy = JSON.stringify({ retainHomeRuntime: b.entry.retainHomeRuntime, stagesOwner: b.entry.stagesOwner });
    native.push(`load: async () => { ${prepareStyles}return (await import('@wildshard/engine/game/shard/declaredEntry')).declaredClientPlanEntry(${policy}); }`);
  }
  for (const key of ['load', 'ktx2']) if (b[key]) {
    if (key === 'ktx2' && b[key].program === true) {
      native.push(`ktx2: () => Promise.resolve({ GPU_FILES: ${value(b[key], 'ktx2')} })`);
    } else if (key === 'ktx2' && b[key].platform === 'page-mode') {
      const ref = b[key].rows;
      const mapper = b.boot?.platform === 'page-mode' ? 'pageModeKtx2' : "(await import('@wildshard/engine/game/shard/pageBoot')).pageModeKtx2";
      // A source program supplies both page modes' GPU tables as the `ktx2.pageModes` discovery value.
      if (ref.program === true) native.push(`ktx2: async () => ${mapper}(${value(ref, 'ktx2.pageModes')})`);
      else {
        if (ref.export !== 'default' || !ref.module.endsWith('.json')) throw new Error(`${file}: page KTX2 requires default JSON rows`);
        native.push(`ktx2: async () => ${mapper}((await import(${JSON.stringify(modulePath(ref.module))}, { with: { type: 'json' } })).default)`);
      }
    } else native.push(b[key].export ? `${key}: async () => ${lazy(b[key], true)}` : `${key}: () => import(${JSON.stringify(modulePath(b[key].module))})`);
  }
  if (b.posesLoader) native.push(`dev: {poses: async () => ${lazy(b.posesLoader, true)}}`);
  // The helper lives in the generated file behind a type-only import, so a build of an older revision that meets this file
  // in a mirror (its generators import it before gen-shards rewrites it) still loads.
  const forwards = native.some(row => row.includes('callWithProduct('));
  // The committed dependency table describes this exact runtime import graph,
  // without needing any program values or previously emitted discovery file.
  const actualImports = ['../../game/client/shard/manifest', ...(composed === null ? ['./manifest.json'] : []),
    ...imports.map(source => {
      const match = /from (['"])([^'"]+)\1(?: with \{ type: 'json' \})?;$/u.exec(source);
      if (match === null) throw new Error(`${file}: invalid emitted static import`);
      return match[2];
    }), ...paths.map(path => `./${relative(resolve(root, `src/shards/${folder}`), resolve(root, path.slice(1))).replaceAll('\\', '/')}`)];
  if (JSON.stringify([...new Set(actualImports)].sort((left, right) => left.localeCompare(right))) !== JSON.stringify(authoredManifestImports(root, folder, data, composed !== null))) throw new Error(`${file}: declared static imports differ from discovery`);
  return `// Generated by scripts/gen-shards.mjs — do not edit or commit.
import { ${['defineAuthoredShard', ...declared.map(key => DECLARED[key])].join(', ')} } from '../../game/client/shard/manifest';
${composed === null ? "import data from './manifest.json' with { type: 'json' };" : `const data = ${JSON.stringify(data)};`}${forwards ? `
import type { ShardProduct } from '../../game/shared/shardfile/shardProduct';` : ''}
${imports.join('\n')}
${paths.map((path, i) => `import image${i} from ${JSON.stringify(`./${relative(resolve(root, `src/shards/${folder}`), resolve(root, path.slice(1))).replaceAll('\\', '/')}`)};`).join('\n')}
${forwards ? `/** A look or roster factory called with the shard's product; a factory that takes none is accepted as it is. */
const callWithProduct = <T>(make: (product: ShardProduct) => T, product: ShardProduct): T => make(product);
` : ''}const rows: Parameters<typeof defineAuthoredShard>[2] = { ${rows.join(', ')} };
const native: Parameters<typeof defineAuthoredShard>[3] = { ${native.join(', ')} };
export const MANIFEST: ReturnType<typeof defineAuthoredShard> = defineAuthoredShard(data, ${JSON.stringify(slug)}, rows, native, {${paths.map((path, i) => `${JSON.stringify(path)}: image${i}`).join(', ')}});
// oxlint-disable-next-line import/no-default-export -- Generated folder discovery composes the defining manifest.
export default MANIFEST;
`;
}
