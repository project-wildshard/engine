#!/usr/bin/env node
// E362 AG21: the public API surface, generated. The TypeScript compiler reads the engine / game / sdk / commons indexes and the
// ShardContext / LevelContext interfaces; every export and member is listed with its kind and the first line of its
// JSDoc in lint/api-surface.json (under lint/: an exported tree keeps it, it may drop docs/) and rendered to
// docs/api/{ENGINE,GAME,SDK,COMMONS,SHARD-CONTEXT}.md, plus docs/api/EXPORTS.md (the export index that used to be ENGINE.md's
// appendix) and docs/api/SHARDFILE.md. SF74 W13 (Jake, G281): all of them are build outputs, gitignored; `pnpm docs` writes
// them (scripts/docs.mjs), so nobody commits them and no push regenerates them.
//   node scripts/gen-api.mjs           write them
//   node scripts/gen-api.mjs --check   fail when more exports lack a doc line than lint/api-undocumented.json allows (a
//                                      ceiling that may only fall)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from '@typescript/typescript6';
import { APPENDIX_END, APPENDIX_START, engineAppendix } from './generated-policy.mjs';
import { layerFolder } from './format-package.mjs';

const ROOT = resolve(import.meta.dirname, '..');
// E434: no index files; a package's public surface is every module its package.json `exports` lists
const PACKAGES = ['engine', 'format', 'game', 'sdk', 'sharddev', 'commons'];
const modulesOf = (root, layer) => Object.entries(JSON.parse(readFileSync(resolve(root, layerFolder(layer), 'package.json'), 'utf8')).exports ?? {})
  .filter(([subpath, target]) => typeof target === 'string' && !subpath.endsWith('.json')).map(([subpath, target]) => ({ specifier: `@wildshard/${layer}/${subpath.slice(2)}`, file: `${layerFolder(layer)}/${target.slice(2)}` }));
const CONTEXTS = { LevelContext: 'src/server/engine/level/context.ts', ShardContext: 'src/client/game/plugin/context.ts' };
const SURFACE = 'lint/api-surface.json', CEILING = 'lint/api-undocumented.json';

const firstLine = (text) => text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
function kindOf(symbol) {
  const f = symbol.flags, S = ts.SymbolFlags;
  if (f & S.Class) return 'class';
  if (f & S.Function) return 'function';
  if (f & S.Interface) return 'interface';
  if (f & S.TypeAlias) return 'type';
  if (f & S.Enum) return 'enum';
  if (f & S.Variable) return 'const';
  if (f & S.Module) return 'namespace';
  return 'other';
}
const docOf = (symbol, checker) => firstLine(ts.displayPartsToString(symbol.getDocumentationComment(checker)));

/** the surface: per package the exports of every module it exports (with the module to import it from), per context its members */
export function apiSurface(root = ROOT) {
  const configPath = ts.findConfigFile(root, (f) => ts.sys.fileExists(f));
  const config = configPath ? ts.readConfigFile(configPath, (f) => ts.sys.readFile(f)).config : {};
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const modules = Object.fromEntries(PACKAGES.filter(layer => existsSync(resolve(root, layerFolder(layer), 'package.json'))).map((layer) => [layer, modulesOf(root, layer)]));
  const files = [...Object.values(modules).flat().map((m) => m.file), ...Object.values(CONTEXTS)].map((f) => resolve(root, f));
  const program = ts.createProgram(files, { ...options, noEmit: true });
  const checker = program.getTypeChecker();
  const out = { indexes: {}, contexts: {} };
  const internalPath = resolve(root, 'lint/engine-internal.json');
  const internal = new Set(existsSync(internalPath) ? Object.keys(JSON.parse(readFileSync(internalPath, 'utf8')).names) : []);
  for (const [name, list] of Object.entries(modules)) {
    out.indexes[name] = list.flatMap(({ specifier, file }) => {
      const source = program.getSourceFile(resolve(root, file));
      const module = source && checker.getSymbolAtLocation(source);
      if (!module) return []; // a module with no exports (a side-effect module)
      return checker.getExportsOfModule(module).map((sym) => {
        const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
        const row = { name: sym.getName(), kind: kindOf(target), doc: docOf(target, checker), from: specifier };
        if (name === 'engine' && internal.has(row.name)) row.gameOnly = true;
        return row;
      });
    }).sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
  }
  for (const [name, file] of Object.entries(CONTEXTS)) {
    const source = program.getSourceFile(resolve(root, file));
    const decl = source?.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === name);
    if (!decl) throw new Error(`gen-api: no interface ${name} in ${file}`);
    const type = checker.getTypeAtLocation(decl.name);
    out.contexts[name] = checker.getPropertiesOfType(type).map((p) => ({
      name: p.getName(), kind: p.flags & ts.SymbolFlags.Method ? 'method' : 'property', doc: docOf(p, checker),
      from: p.parent?.getName() === name ? name : (p.parent?.getName() ?? ''),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

const cell = (s) => (s === '' ? '—' : s.replaceAll('|', String.raw`\|`));
/** the page for one index or context */
export function renderPage(title, intro, rows, withFrom = false) {
  const head = withFrom ? '| Member | Kind | From | What it is |\n|---|---|---|---|' : '| Export | Kind | What it is |\n|---|---|---|';
  const body = rows.map((r) => (withFrom ? `| \`${r.name}\` | ${r.kind}${r.gameOnly ? ' · game only' : ''} | ${r.from} | ${cell(r.doc)} |` : `| \`${r.name}\` | ${r.kind}${r.gameOnly ? ' · game only' : ''} | ${cell(r.doc)} |`)).join('\n');
  return `# ${title}\n\n<!-- generated by scripts/gen-api.mjs from the TypeScript sources: do not edit -->\n\n${intro}\n\n${rows.length} ${withFrom ? 'members' : 'exports'}; ${rows.filter((r) => !r.doc).length} without a doc line (—).\n\n${head}\n${body}\n`;
}
export function pages(surface) {
  return {
    ...(surface.indexes.format === undefined ? {} : {'docs/api/FORMAT.md': renderPage('@wildshard/format', 'The pure Valibot wire contracts shared by authoring and admission.', surface.indexes.format, true)}),
    'docs/api/ENGINE.md': renderPage('@wildshard/engine', 'The engine\'s public modules (src/engine/package.json `exports`; no index file). docs/ENGINE.md explains them by area; this is the full list, each with the module to import it from.', surface.indexes.engine, true),
    'docs/api/GAME.md': renderPage('@wildshard/game', 'The game layer\'s public modules (src/game/package.json `exports`).', surface.indexes.game, true),
    'docs/api/SDK.md': renderPage('@wildshard/sdk', 'The headless and standalone host (src/server/host/package.json `exports`), which leaves for the engine at P3.', surface.indexes.sdk, true),
    'docs/api/SHARDDEV.md': `${renderPage('@wildshard/sharddev', 'The author SDK public modules (src/sharddev/package.json `exports`); shard projects use this surface.', surface.indexes.sharddev, true)}\n${authoringGuide()}`,
    'docs/api/COMMONS.md': renderPage('@wildshard/commons', 'Build-time packs and catalogue (src/commons/package.json `exports`); no commons code executes in the game.', surface.indexes.commons, true),
    'docs/api/SHARD-CONTEXT.md': renderPage('ShardContext', 'What a shard\'s plugin receives (src/client/game/plugin/context.ts, over the engine\'s LevelContext).', surface.contexts.ShardContext, true),
  };
}
/** docs/api/EXPORTS.md: every package's export index, grouped by the module to import each name from. */
export const EXPORTS_PAGE = 'docs/api/EXPORTS.md';
export function exportsPage(surface) {
  const list = engineAppendix(surface).replace(APPENDIX_START, '').replace(APPENDIX_END, '').trim();
  return `# Every export\n\n<!-- generated by scripts/gen-api.mjs (pnpm docs): do not edit -->\n\nEach package's exported modules (its package.json \`exports\`) and the names each exports. [docs/ENGINE.md](../ENGINE.md) describes what to use; this list is the complete inventory.\n\n${list}\n`;
}
/** Every API build output: the surface (lint/, kept by an exported tree) and, when docs/ exists, the pages. */
export function apiOutputs(root = ROOT, surface = apiSurface(root)) {
  const outputs = { [SURFACE]: `${JSON.stringify(surface, null, 2)}\n` };
  if (existsSync(resolve(root, 'docs'))) Object.assign(outputs, pages(surface), { [EXPORTS_PAGE]: exportsPage(surface) });
  return outputs;
}
/** Write the outputs whose bytes changed (`pnpm docs`); returns the surface for the ceiling check. */
export function writeApiDocs(root = ROOT) {
  const surface = apiSurface(root);
  for (const [file, text] of Object.entries(apiOutputs(root, surface))) {
    const path = resolve(root, file);
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
    mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, text);
  }
  return surface;
}
export const undocumented = (surface) => [...Object.values(surface.indexes), ...Object.values(surface.contexts)].flat().filter((r) => !r.doc).length;

function main(check) {
  const surface = check ? apiSurface() : writeApiDocs();
  const ceilingPath = resolve(ROOT, CEILING);
  const ceiling = existsSync(ceilingPath) ? JSON.parse(readFileSync(ceilingPath, 'utf8')).max : Infinity;
  const n = undocumented(surface), failures = [];
  if (n > ceiling) failures.push(`${n} exports / members without a doc line, over the ceiling ${ceiling} (${CEILING}): give the new ones a JSDoc line`);
  if (!check && n < ceiling && ceiling !== Infinity) console.warn(`gen-api: ${n} undocumented, under the ceiling ${ceiling}: lower ${CEILING}`);
  if (failures.length > 0) { console.error(`gen-api (AG21):\n  ${failures.join('\n  ')}`); return 1; }
  console.log(`gen-api: ${Object.values(surface.indexes).flat().length} exports, ${n} without a doc line`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(process.argv.includes('--check')); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
