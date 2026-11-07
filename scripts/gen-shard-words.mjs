// E362 AG14: discover vocabulary and ownership without loading shard runtime modules.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { outputManifest, shardOutputs } from './shard-outputs.mjs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'vite';

const unwrap = (node) => {
  let value = node;
  while (value?.expression && ['TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(value.type)) value = value.expression;
  return value;
};
const keyOf = (node) => node?.name ?? node?.value;
const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) { for (const child of value) walk(child, visit); }
    else if (value && typeof value === 'object') walk(value, visit);
  }
};

/** Read only the static data used by manifests and declared species/weapon rows. */
export function shardWordData(root, shard) {
  const requested = shard;
  if (requested !== undefined && (!/^[a-z0-9_-]+$/.test(requested) || !(existsSync(resolve(root, 'src/shards', requested, 'manifest.ts')) || existsSync(resolve(root, 'src/shards', requested, 'manifest.json'))))) {
    throw new Error(`gen-shards: unknown shard ${shard}`);
  }
  const modules = new Map(), resolving = new Set();
  const find = (base) => [base, `${base}.ts`, `${base}/index.ts`].find((file) => existsSync(file) && file.endsWith('.ts'));
  const module = (file) => {
    if (modules.has(file)) return modules.get(file);
    const parsed = parseSync(file, readFileSync(file, 'utf8'));
    if (parsed.errors.length > 0) throw new Error(`Cannot read shard vocabulary: ${file}`);
    const bindings = new Map(), exports = new Map();
    const mod = { file, bindings, exports, program: parsed.program };
    modules.set(file, mod);
    for (const stmt of parsed.program.body) {
      if (stmt.type === 'ImportDeclaration') {
        const source = stmt.source.value;
        const base = source.startsWith('.') ? resolve(dirname(file), source) : null;
        const target = base ? find(base) : null;
        for (const spec of stmt.specifiers) if (target) bindings.set(spec.local.name, { target, name: spec.imported ? keyOf(spec.imported) : 'default' });
      }
      const declaration = stmt.declaration ?? stmt;
      if (declaration.type === 'VariableDeclaration') for (const d of declaration.declarations) if (d.id.type === 'Identifier') bindings.set(d.id.name, d.init);
      if (declaration.type === 'FunctionDeclaration' && declaration.id) bindings.set(declaration.id.name, declaration);
      if (stmt.type === 'ExportDefaultDeclaration') exports.set('default', stmt.declaration);
      if (stmt.type === 'ExportNamedDeclaration') {
        if (declaration.type === 'VariableDeclaration') for (const d of declaration.declarations) if (d.id.type === 'Identifier') exports.set(d.id.name, d.init);
        if (declaration.type === 'FunctionDeclaration' && declaration.id) exports.set(declaration.id.name, declaration);
        for (const s of stmt.specifiers) {
          const target = stmt.source?.value.startsWith('.') ? find(resolve(dirname(file), stmt.source.value)) : null;
          exports.set(keyOf(s.exported), target ? { target, name: keyOf(s.local) } : { type: 'Identifier', name: keyOf(s.local) });
        }
      }
    }
    return mod;
  };
  const value = (raw, mod, locals = new Map(), depth = 0) => {
    const n = unwrap(raw);
    if (!n || depth > 35) return undefined;
    const get = (node, vars = locals) => value(node, mod, vars, depth + 1);
    if (n.target) {
      const mark = `${n.target}:${n.name}`;
      if (resolving.has(mark)) return undefined;
      resolving.add(mark);
      try { const other = module(n.target); return value(other.exports.get(n.name), other, locals, depth + 1); }
      finally { resolving.delete(mark); }
    }
    if (n.type === 'Literal') return n.value;
    if (n.type === 'Identifier') {
      if (locals.has(n.name)) return locals.get(n.name);
      const mark = `${mod.file}:${n.name}`;
      if (resolving.has(mark)) return undefined;
      resolving.add(mark);
      try { return get(mod.bindings.get(n.name)); } finally { resolving.delete(mark); }
    }
    if (n.type === 'ArrayExpression') return n.elements.flatMap((item) => item?.type === 'SpreadElement' ? get(item.argument) ?? [] : [get(item)]);
    if (n.type === 'ObjectExpression') {
      const result = {};
      for (const p of n.properties) {
        if (p.type === 'SpreadElement') Object.assign(result, get(p.argument));
        else { const key = p.computed ? get(p.key) : keyOf(p.key); if (typeof key === 'string') result[key] = get(p.value); }
      }
      return result;
    }
    if (n.type === 'MemberExpression') return get(n.object)?.[n.computed ? get(n.property) : keyOf(n.property)];
    // A runtime-selected callback set can retain its literal admitted rows as a nullish fallback.
    // Read that static declaration without executing the selector or dropping its registered vocabulary.
    if (n.type === 'LogicalExpression' && n.operator === '??') return get(n.left) ?? get(n.right);
    if (n.type === 'TemplateLiteral') {
      const parts = n.expressions.map((e) => get(e));
      return parts.some((p) => p === undefined) ? undefined : n.quasis.map((q, i) => `${q.value.cooked ?? q.value.raw}${parts[i] ?? ''}`).join('');
    }
    if (['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression'].includes(n.type)) return { fn: n, mod };
    if (n.type === 'CallExpression') {
      const call = (fn, args) => {
        if (!fn?.fn) return undefined;
        const vars = new Map(locals);
        fn.fn.params.forEach((p, i) => { if (p.type === 'Identifier') vars.set(p.name, args[i]); });
        const body = fn.fn.body;
        const ret = body.type === 'BlockStatement' ? body.body.find((s) => s.type === 'ReturnStatement')?.argument : body;
        return value(ret, fn.mod, vars, depth + 1);
      };
      if (keyOf(n.callee.property) === 'map') {
        const items = get(n.callee.object), fn = get(n.arguments[0]);
        return Array.isArray(items) ? items.map((item) => call(fn, [item])) : undefined;
      }
      if (n.callee.name === 'deriveSpecies') return { ...get(n.arguments[0]), ...get(n.arguments[1]) };
      return call(get(n.callee), n.arguments.map((arg) => get(arg)));
    }
    return undefined;
  };
  const shards = {};
  for (const entry of readdirSync(resolve(root, 'src/shards'), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (requested !== undefined && entry.name !== requested) continue;
    if (!entry.isDirectory()) continue;
    const file = resolve(root, 'src/shards', entry.name, 'manifest.ts');
    const json = resolve(root, 'src/shards', entry.name, 'manifest.json');
    if (!existsSync(file) && !existsSync(json)) continue;
    const mod = existsSync(json) ? null : module(file);
    const data = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : [...mod.exports.values()].map((n) => value(n, mod)).find((v) => v && typeof v === 'object' && typeof v.slug === 'string');
    const settings = new Set(data?.debugOptions);
    const ids = new Set();
    const plugins = new Set([find(resolve(dirname(file), 'plugin'))]);
    // A mechanical plugin extraction must preserve the shard's ownership vocabulary. Read only its declared entry,
    // without importing trusted code or treating every helper in runtime/ as a plugin.
    const config = find(resolve(dirname(file), 'shard.config'));
    if (config) {
      const authored = module(config);
      walk(authored.program, (node) => {
        if (node.type !== 'Property' || keyOf(node.key) !== 'runtime') return;
        const declaration = value(node.value, authored);
        if (declaration?.entry === 'runtime/index.ts') plugins.add(find(resolve(dirname(file), 'runtime/index')));
      });
    }
    for (const plugin of plugins) if (plugin) {
      const pm = module(plugin);
      walk(pm.program, (n) => {
        if (n.type === 'CallExpression' && keyOf(n.callee.property) === 'debugRow') {
          const row = value(n.arguments[0], pm);
          if (typeof row?.id === 'string') { settings.add(row.id); settings.add(`${entry.name}.${row.id}`); }
        }
        if (n.type !== 'CallExpression' || !['species', 'weapon'].includes(keyOf(n.callee.property)) || keyOf(n.callee.object?.property) !== 'rows') return;
        const rows = value(n.arguments[0], pm);
        for (const row of Array.isArray(rows) ? rows : [rows]) if (typeof row?.id === 'string') ids.add(row.id);
      });
    }
    shards[entry.name] = { name: data?.name ?? entry.name, ids: [...ids].sort((a, b) => a.localeCompare(b)), settings: [...settings].sort((a, b) => a.localeCompare(b)), assets: data?.assetGlobs ?? [] };
    // SF88g: each declared output is a product of its own name; the folder keeps the source assets, an output owns its map
    for (const output of shardOutputs(root, entry.name) ?? []) shards[output.slug] = { name: outputManifest(root, entry.name, output.row).name ?? output.slug,
      ids: shards[entry.name].ids, settings: shards[entry.name].settings, assets: [`public/assets/${output.slug}/**`] };
  }
  return wordInventory(shards);
}

function wordInventory(shards, sharedAssets = ['public/assets/tex/**', 'public/assets/gpu/tex/**', 'public/assets/hdri/**', 'public/assets/gpu/hdri/**', 'public/assets/sfx/best/**', 'public/assets/practice/**']) {
  const slugs = Object.keys(shards).filter((slug) => !slug.startsWith('_')).sort((a, b) => a.localeCompare(b));
  // These are the engine/kit's shared texture, sky, SFX and practice namespaces, never another shard's folder.
  return { slugs, words: [...new Set(slugs.flatMap((slug) => [slug, shards[slug].name].concat(shards[slug].ids)))].sort((a, b) => a.localeCompare(b)), sharedAssets, shards };
}

export function genShardWords(root = resolve(import.meta.dirname, '..'), check = false, shard = '') {
  const file = resolve(root, 'lint/shard-words.generated.json');
  let data = shardWordData(root, shard || undefined);
  if (shard !== '') {
    if (!existsSync(file)) throw new Error('gen-shards: scoped generation needs lint/shard-words.generated.json (run pnpm gen once)');
    const prior = JSON.parse(readFileSync(file, 'utf8'));
    if (!prior.shards || typeof prior.shards !== 'object' || Array.isArray(prior.shards) || !Array.isArray(prior.sharedAssets)) throw new Error('gen-shards: invalid prior shard vocabulary');
    const merged = { ...prior.shards, ...data.shards };
    const sorted = Object.fromEntries(Object.keys(merged).sort((a, b) => a.localeCompare(b)).map((slug) => [slug, merged[slug]]));
    data = wordInventory(sorted, prior.sharedAssets);
  }
  const source = `${JSON.stringify(data, null, 2)}\n`;
  const same = existsSync(file) && readFileSync(file, 'utf8') === source;
  if (check && !same) throw new Error('gen-shards: stale lint/shard-words.generated.json (run pnpm gen)');
  if (!check && !same) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source); }
}
/** P3: the words engine's lint keeps once shard source leaves. `test/shard-words-pin.test.ts` holds it to the source. */
export function pinShardWords(root = resolve(import.meta.dirname, '..')) {
  writeFileSync(resolve(root, 'lint/shard-words.pin.json'), `${JSON.stringify(shardWordData(root), null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv.includes('--pin')) pinShardWords();
  else genShardWords(undefined, process.argv.includes('--check'), process.argv.find((arg) => arg.startsWith('--shard='))?.slice(8));
}
