import ts from '@typescript/typescript6';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readModuleFiles } from '../../src/client/engine/boot/download';
import { homeClientModuleGroups, bootProductTotals } from './bootProducts';
import { bootTierProductTotals } from './bootProductTiers';
import { homeExtraFiles } from './bootExtras';
import { createHash } from 'node:crypto';
import { writtenBundle } from './writtenBundle';

/** Only imports actually scheduled by startSelected; title, recovery and error
 * branches elsewhere in the entry module are not home requirements. */
export function startupImports(source: string): string[] {
  const file = ts.createSourceFile('entry.ts', source, ts.ScriptTarget.Latest, true);
  const selected = file.statements.find(row => ts.isFunctionDeclaration(row) && row.name?.text === 'startSelected');
  if (selected === undefined) throw new Error('Missing selected startup import bank');
  const imports = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      for (let owner = node.parent; owner !== selected; owner = owner.parent) {
        if (ts.isIfStatement(owner) || ts.isConditionalExpression(owner) || ts.isSwitchStatement(owner)
          || ts.isCatchClause(owner) || ts.isForStatement(owner) || ts.isForOfStatement(owner) || ts.isForInStatement(owner)
          || ts.isWhileStatement(owner) || ts.isDoStatement(owner)) {
          throw new Error('Conditional startup imports require a selected module bank');
        }
        if (ts.isArrowFunction(owner) && (!ts.isCallExpression(owner.parent) || owner.parent.expression.getText(file) !== 'retried')) {
          throw new Error('Deferred startup imports require a selected module bank');
        }
        if (ts.isFunctionExpression(owner) || ts.isFunctionDeclaration(owner)) throw new Error('Deferred startup imports require a selected module bank');
      }
      if (node.arguments.length !== 1) throw new Error('Startup import requires a literal source');
      const argument = node.arguments[0];
      if (argument === undefined || !ts.isStringLiteral(argument)) throw new Error('Startup import requires a literal source');
      imports.add(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(selected);
  return [...imports];
}

/** Literal optional imports stay attached to their defining feature row. */
export function clientFeatureImports(source: string): Readonly<Record<string, readonly string[]>> {
  const file = ts.createSourceFile('clientPlan.ts', source, ts.ScriptTarget.Latest, true);
  const rows: Record<string, string[]> = {};
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'CLIENT_FEATURES' && node.initializer !== undefined && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) throw new Error('Feature module bank requires literal feature rows');
        rows[property.name.text] = literalImports(property.initializer);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return rows;
}
function literalImports(node: ts.Node): string[] {
  const rows = new Set<string>();
  const visit = (entry: ts.Node): void => {
    if (ts.isCallExpression(entry) && entry.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [source] = entry.arguments;
      if (source === undefined || !ts.isStringLiteral(source)) throw new Error('Boot module requires a literal import');
      rows.add(source.text);
    }
    ts.forEachChild(entry, visit);
  };
  visit(node); return [...rows];
}
function sourceImports(file: string): readonly string[] {
  return existsSync(file) ? literalImports(ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)) : [];
}

interface EmittedFile {
  readonly type: string;
  readonly code?: string;
  readonly source?: string | Uint8Array;
  readonly imports?: readonly string[];
  readonly originalFileNames?: readonly string[];
  readonly modules?: Readonly<Record<string, unknown>>;
  readonly facadeModuleIds?: readonly string[];
}
type Bundle = Readonly<Record<string, EmittedFile | undefined>>;
export type ModuleFile = readonly [url: string, bytes: number];

/** Static closure only: dynamic imports describe possible future work. Imported
 * asset URL strings do not imply image/model downloads either. */
export function bootModuleFiles(bundle: Bundle, roots: readonly string[]): readonly ModuleFile[] {
  const files = new Set<string>();
  const visit = (name: string): void => {
    if (files.has(name)) return;
    const file = bundle[name];
    if (file?.type !== 'chunk' || file.code === undefined) throw new Error(`Missing boot module dependency: ${name}`);
    files.add(name);
    for (const dependency of file.imports ?? []) visit(dependency);
  };
  for (const root of roots) {
    // A grouped dynamic entry may have a tiny manifest facade and an implementation
    // source map in another chunk. Follow the compiler's actual import target.
    const facades = Object.entries(bundle).filter(([, file]) => file?.type === 'chunk' && file.facadeModuleIds?.includes(root) === true);
    const found = facades.length > 0 ? facades : Object.entries(bundle).filter(([, file]) => file?.type === 'chunk' && Object.hasOwn(file.modules ?? {}, root));
    if (found.length !== 1) throw new Error(`Missing or ambiguous boot module root: ${root}`);
    for (const [name] of found) visit(name);
  }
  // cssCodeSplit=false: the page always reads the single extracted stylesheet.
  for (const [name, file] of Object.entries(bundle)) if (file?.type === 'asset' && name.endsWith('.css')) files.add(name);
  return readModuleFiles([...files].sort().map(name => {
    const file = bundle[name];
    const bytes = file?.type === 'chunk' ? file.code : file?.source;
    if (bytes === undefined) throw new Error(`Missing boot module bytes: ${name}`);
    return [`/${name}`, typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength];
  }));
}

/** One shared file table avoids repeating common chunks for every feature. */
export function bootModuleGroups(bundle: Bundle, roots: Readonly<Record<string, readonly string[]>>): {
  files: ModuleFile[]; groups: Record<string, number[]>;
} {
  const files: ModuleFile[] = [], indexes = new Map<string, number>(), groups: Record<string, number[]> = {};
  for (const [kind, paths] of Object.entries(roots)) groups[kind] = paths.length === 0 ? [] : bootModuleFiles(bundle, paths).map(row => {
    const prior = indexes.get(row[0]); if (prior !== undefined) return prior;
    const next = files.length; indexes.set(row[0], next); files.push(row); return next;
  });
  return {files,groups};
}

/** A module request as the bundler resolves it for these sources: a relative path with its TypeScript extension or index,
 *  else a workspace or package specifier through its package exports. */
function resolveImport(request: string, importer: string): { readonly id: string } | null {
  if (request.startsWith('.')) {
    const base = resolve(dirname(importer), request);
    for (const suffix of ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.json', '/index.ts']) {
      const file = base + suffix;
      if (existsSync(file) && statSync(file).isFile()) return { id: file };
    }
    return null;
  }
  try { return { id: createRequire(importer).resolve(request) }; } catch { return null; }
}

/** Compiler-owned facts ride the existing shell, including offline launches: the boot module bank goes into the written
 *  index.html, and each home's extra file table beside it (was vite/bootModules.ts's output hook). No metadata fetch,
 *  speculative import or new service-worker install list. scripts/build-app.mjs runs it on the web build, before the
 *  service worker reads the bank. */
export function startupModuleRoots(root: string): readonly string[] {
  const entry = resolve(root, 'src/client/app/entry.ts');
  const requests = startupImports(readFileSync(entry, 'utf8'));
  const ids: string[] = [entry];
  for (const request of requests) {
    const dependency = resolveImport(request, entry);
    if (dependency === null) throw new Error(`Unresolved boot module: ${request}`);
    ids.push(dependency.id);
  }
  return ids;
}

/** Existing grid import requirements, shared by chunking and its bank. */
export function gridModuleRoots(root: string): readonly string[] {
  const entry = resolve(root, 'src/client/app/entry.ts');
  const grid = resolveImport('../game/grid/session', entry);
  if (grid === null) throw new Error('Missing grid session module');
  const gridRoots = [grid.id];
  for (const file of ['src/client/game/session/play.ts', 'src/client/game/session/loadout.ts']) {
    const importer = resolve(root, file);
    for (const request of sourceImports(importer).filter(name => name.startsWith('../grid/'))) {
      const dependency = resolveImport(request, importer);
      if (dependency === null) throw new Error('Missing grid boot module');
      gridRoots.push(dependency.id);
    }
  }
  return gridRoots;
}

/** The same literal feature roots feed code batching and the emitted preload bank. */
function optionalModuleRoots(root: string): Record<string, string[]> {
  const client = resolveImport('../game/shardfile/client', resolve(root, 'src/client/app/entry.ts'));
  if (client === null) throw new Error('Missing compiled client module');
  const planFile = resolve(root, 'src/client/game/shardfile/clientPlan.ts'), featureRoots: Record<string, string[]> = {};
  const features = existsSync(planFile) ? clientFeatureImports(readFileSync(planFile, 'utf8')) : {};
  for (const [kind, imports] of Object.entries(features)) {
    const paths: string[] = [];
    for (const request of imports) {
      const dependency = resolveImport(request, planFile);
      if (dependency === null) throw new Error('Missing optional client module');
      paths.push(dependency.id);
    }
    featureRoots[kind] = paths;
  }
  for (const [kind, request] of [['presentation', '../plugin/ui'], ['loot', '../loot/runtime'], ['compendium', '../compendium/install']] as const) {
    featureRoots[kind] = [];
    if (!sourceImports(client.id).includes(request)) continue;
    const dependency = resolveImport(request, client.id);
    if (dependency === null) throw new Error('Missing optional client presentation');
    featureRoots[kind].push(dependency.id);
  }
  // Practice keeps its synchronous room; only arena arrivals await these existing lazy model/clip loaders.
  const practice: string[] = [];
  for (const file of ['src/client/engine/practice/TrainingArena.ts', 'src/client/engine/models/trainingDummy.ts', 'src/client/engine/models/trainingDummyFigure.ts']) {
    const importer = resolve(root, file);
    for (const request of sourceImports(importer)) {
      const dependency = resolveImport(request, importer);
      if (dependency === null) throw new Error('Missing practice model module');
      practice.push(dependency.id);
    }
  }
  featureRoots['practice.models'] = practice;
  for (const [kind, file] of [['models.gltf', 'src/client/engine/anim/rig.ts'], ['legacy.gltf', 'src/client/game/shard/load.ts']] as const) {
    const importer = resolve(root, file), paths: string[] = [];
    for (const request of sourceImports(importer)) {
      const dependency = resolveImport(request, importer);
      if (dependency === null) throw new Error('Missing optional GLTF module');
      paths.push(dependency.id);
    }
    featureRoots[kind] = paths;
  }
  const loadout = resolve(root, 'src/client/game/session/loadout.ts');
  featureRoots['explorer.catalogue'] = [];
  for (const request of sourceImports(loadout).filter(name => name === '../models/explorerCatalogue')) {
    const dependency = resolveImport(request, loadout);
    if (dependency === null) throw new Error('Missing selected Explorer module');
    featureRoots['explorer.catalogue'].push(dependency.id);
  }
  return featureRoots;
}

function selectedHomeRoots(root: string, directory: string, features: Readonly<Record<string, readonly string[]>>): string[] {
  return homeClientModuleGroups(root, directory).flatMap(kind => {
    const roots = features[kind];
    if (roots === undefined) throw new Error(`Missing selected home code group: ${kind}`);
    return roots;
  });
}

/** Actual product-selected feature roots, without copying their data into JavaScript. */
export function homeModuleRoots(root: string): readonly (readonly string[])[] {
  const features = optionalModuleRoots(root);
  return Object.keys(bootProductTotals(root)).sort().map(prefix => {
    const directory = prefix.split('/')[2];
    if (directory === undefined) throw new Error('Missing boot home directory');
    return selectedHomeRoots(root, directory, features);
  });
}

export function writeBootModules(outDir: string, root: string): void {
  const bundle = writtenBundle(outDir, root);
  const entry = resolve(root, 'src/client/app/entry.ts'), ids = startupModuleRoots(root);
  const htmlFile = join(outDir, 'index.html'), html = existsSync(htmlFile) ? readFileSync(htmlFile, 'utf8') : '';
  if (!html.includes('<head>')) throw new Error('Missing boot module document');
  const client = resolveImport('../game/shardfile/client', entry);
  if (client === null) throw new Error('Missing compiled client module');
  const gridRoots = gridModuleRoots(root);
  const featureRoots = optionalModuleRoots(root);
  const products = bootTierProductTotals(root), extras: Record<string, readonly [string, number, number, string]> = {};
  for (const prefix of Object.keys(products)) {
    const directory = prefix.split('/')[2];
    if (directory === undefined) throw new Error('Missing boot home directory');
    featureRoots[`home:${prefix}`] = selectedHomeRoots(root, directory, featureRoots);
    const files = homeExtraFiles(root, directory);
    if (files === null) continue;
    const source = JSON.stringify(files), hash = createHash('sha256').update(source).digest('hex');
    const name = `assets/boot-${directory}-${hash.slice(0, 8)}.json`;
    writeFileSync(join(outDir, name), source);
    extras[prefix] = [`/${name}`, Buffer.byteLength(source), files.reduce((sum, row) => sum + row[1], 0), hash];
  }
  featureRoots['boot.common']=[...ids];
  const rows = { common: bootModuleFiles(bundle, ids), client: bootModuleFiles(bundle, [client.id]), grid: bootModuleFiles(bundle, gridRoots), optional: bootModuleGroups(bundle, featureRoots), products, extras };
  const json = JSON.stringify(rows).replaceAll('<', String.raw`\u003c`);
  writeFileSync(htmlFile, html.replace('<head>', `<head><script type="application/json" id="boot-module-files">${json}</script>`));
}
