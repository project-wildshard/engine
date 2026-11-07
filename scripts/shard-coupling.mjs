#!/usr/bin/env node
// SF2: count typed boundary reaches and engine inheritance, never comments or identifier spelling.
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import ts from '@typescript/typescript6';

const ROOT = resolve(import.meta.dirname, '..');
const LIST = 'lint/shard-coupling.json';
/** Exact predecessor-proven class relocations; raw measured counts remain visible. */
export const CLASS_MOVE_LIST = 'lint/class-moves.json';

/** Hash each complete class body, including its heritage; import relocation does not alter its implementation. */
export function classMoveSites(text, filename, root = ROOT) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true), sites = [];
  const bindings = new Map(), locals = new Set();
  const moduleFile = module => {
    if (module.startsWith('.')) return relative(root, resolve(root, dirname(filename), module.replace(/\.js$/u, '') + (module.endsWith('.ts') ? '' : '.ts'))).replaceAll('\\', '/');
    const match = /^@wildshard\/(engine|game|sdk|sharddev)\/(.+)$/u.exec(module);
    if (match === null) return null;
    const pack = resolve(root, `src/${match[1]}/package.json`);
    const exported = existsSync(pack) ? JSON.parse(readFileSync(pack, 'utf8')).exports?.[`./${match[2]}`] : null;
    return typeof exported === 'string' ? `src/${match[1]}/${exported.replace(/^\.\//u, '')}` : `src/${match[1]}/${match[2]}.ts`;
  };
  const collect = node => {
    if (ts.isClassDeclaration(node) && node.name) locals.add(node.name.text);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bound = node.importClause?.namedBindings;
      if (bound && ts.isNamedImports(bound)) for (const item of bound.elements) bindings.set(item.name.text, moduleFile(node.moduleSpecifier.text));
    }
    ts.forEachChild(node, collect);
  }; collect(source);
  const visit = node => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const heritage = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
      const binding = heritage && ts.isIdentifier(heritage) ? heritage.text : null;
      sites.push({ hash: createHash('sha256').update(node.getText(source)).digest('hex'), name: node.name?.text ?? '<anonymous>',
        baseFile: binding === null ? null : locals.has(binding) ? filename : bindings.get(binding) ?? null,
        heritage: (node.heritageClauses ?? []).map(clause => clause.getText(source)).join(' ') });
    }
    ts.forEachChild(node, visit);
  };
  visit(source); return sites;
}
export const WEAPON_TRANSFER_LIST = 'lint/weapon-subclasses.json';
// Reviewed bootstrap for the two classes relocated by f6d18f088, not a wildcard or a new inheritance budget.
export const WEAPON_TRANSFER_BOOTSTRAP = {
  'src/shards/nalati-grasslands/weapons/Rifle.ts': { class: 'Rifle', from: 'src/kit/weapons/firearm/Rifle.ts', runtime: 'src/shards/nalati-grasslands/runtime/weapons/Rifle.ts', base: 'Weapon', owner: 'SF36' },
};
/** Entries may disappear; a site, class, source, destination, base or removal owner may never grow/change. */
export function compareWeaponTransfers(before, after) {
  const failures = [];
  for (const [file, item] of Object.entries(after)) {
    const previous = before[file];
    if (!previous) failures.push(`${WEAPON_TRANSFER_LIST}: new weapon transfer ${file}`);
    else if (Object.keys(item).length !== Object.keys(previous).length || Object.entries(item).some(([key, value]) => previous[key] !== value)) failures.push(`${WEAPON_TRANSFER_LIST}: immutable weapon transfer changed ${file}`);
  }
  return failures;
}
const CONTEXT_FILES = new Set(['src/client/game/plugin/context.ts', 'src/server/engine/level/context.ts']);
const initial = () => ({ 'ctx.app': 0, 'ctx.game': 0, 'ctx.game.runtime': 0, engineSubclasses: 0 });

export function shardCoupling(root = ROOT) {
  const movePath = resolve(root, CLASS_MOVE_LIST);
  const moves = existsSync(movePath) ? JSON.parse(readFileSync(movePath, 'utf8')).moves : {};
  const usedMoves = new Set();
  const transferPath = resolve(root, WEAPON_TRANSFER_LIST);
  const transfers = existsSync(transferPath) ? JSON.parse(readFileSync(transferPath, 'utf8')).transfers : {};
  const invalid = compareWeaponTransfers(WEAPON_TRANSFER_BOOTSTRAP, transfers);
  if (invalid.length > 0) throw new Error(invalid.join('\n'));
  const files = globSync('src/shards/**/*.{ts,tsx}', { cwd: root }).filter((file) => !file.endsWith('.d.ts') && !file.includes('.generated.'));
  const configPath = resolve(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, root);
  const program = ts.createProgram([...files.map((file) => resolve(root, file)), ...parsed.fileNames.filter((file) => file.endsWith('.merge.d.ts'))], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker(), shards = {};
  const local = (file) => relative(root, file).replaceAll('\\', '/');
  const declarations = (symbol) => symbol?.declarations ?? [];
  const origin = (symbol, names) => declarations(symbol).some((decl) => CONTEXT_FILES.has(local(decl.getSourceFile().fileName)) && names.includes(decl.parent.name?.text));
  // Only declared context members (and GameServices.runtime) can affect this measurement.
  // Resolve their names once instead of asking the checker about every unrelated shard property.
  const contextMembers = new Set(['runtime']);
  for (const source of program.getSourceFiles()) if (CONTEXT_FILES.has(local(source.fileName))) {
    const collect = (node) => {
      if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && ['ShardContext', 'LevelContext'].includes(node.name?.text)) {
        for (const prop of checker.getPropertiesOfType(checker.getTypeAtLocation(node))) if (origin(prop, ['ShardContext', 'LevelContext'])) contextMembers.add(prop.getName());
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
  }
  // JSON closure is conjunctive: reaching a cycle makes the whole reachable type non-data.
  // Memoize completed classifications only; an in-progress recursive edge must still fail.
  const dataTypes = new Map();
  const data = (type, seen = new Set()) => {
    if (dataTypes.has(type)) return dataTypes.get(type);
    if (seen.has(type)) return false; // recursive objects cannot promise a JSON round-trip
    const inspect = () => {
      if (type.isUnion() || type.isIntersection()) return type.types.every((part) => data(part, seen));
      if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
      if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0 || (type.getSymbol()?.flags ?? 0) & ts.SymbolFlags.Class) return false;
      if (!(type.flags & ts.TypeFlags.Object)) return !(type.flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral));
      const next = new Set(seen).add(type);
      if (checker.isArrayType(type) || checker.isTupleType(type)) return checker.getTypeArguments(type).every((part) => data(part, next));
      return checker.getIndexInfosOfType(type).every((info) => data(info.type, next)) && checker.getPropertiesOfType(type).every((prop) => {
        const decl = prop.valueDeclaration ?? prop.declarations?.[0];
        return decl !== undefined && data(checker.getTypeOfSymbolAtLocation(prop, decl), next);
      });
    };
    const result = inspect(); dataTypes.set(type, result); return result;
  };
  const contextProperties = new Map();
  // Keep the Weapon category stable when its content-free platform families gain defining modules.
  // This is typed ancestry to the exact defining class, not a class-name exemption.
  const platformWeapon = (type, seen = new Set()) => {
    if (seen.has(type)) return false;
    const next = new Set(seen).add(type), symbol = type.getSymbol();
    if (declarations(symbol).some((decl) => ts.isClassDeclaration(decl) && local(decl.getSourceFile().fileName) === 'src/shared/engine/combat/Weapon.ts' && decl.name?.text === 'Weapon')) return true;
    if (declarations(symbol).some((decl) => ts.isClassDeclaration(decl))) {
      const declared = checker.getDeclaredTypeOfSymbol(symbol);
      if (declared !== type) return platformWeapon(declared, next);
    }
    if (!(type.flags & ts.TypeFlags.Object) || !(type.objectFlags & ts.ObjectFlags.ClassOrInterface)) return false;
    return checker.getBaseTypes(type).some((base) => platformWeapon(base, next));
  };
  const claimedTransfers = new Set();
  const engineBase = (type, seen = new Set()) => {
    if (seen.has(type)) return null;
    const next = new Set(seen).add(type), symbol = type.getSymbol();
    if (declarations(symbol).some((decl) => ts.isClassDeclaration(decl) && local(decl.getSourceFile().fileName).startsWith('src/engine/'))) return symbol.getName();
    if (declarations(symbol).some((decl) => ts.isClassDeclaration(decl))) {
      const declared = checker.getDeclaredTypeOfSymbol(symbol);
      if (declared !== type) return engineBase(declared, next);
    }
    if (!(type.flags & ts.TypeFlags.Object) || !(type.objectFlags & ts.ObjectFlags.ClassOrInterface)) return null;
    for (const base of checker.getBaseTypes(type)) { const name = engineBase(base, next); if (name !== null) return name; }
    return null;
  };
  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    const slug = file.split('/')[2], source = program.getSourceFile(resolve(root, file));
    if (!slug || !source) throw new Error(`Cannot inspect ${file}`);
    const row = shards[slug] ??= { counts: initial(), sites: {} };
    const add = (metric, node) => {
      row.counts[metric] = (row.counts[metric] ?? 0) + 1;
      const at = source.getLineAndCharacterOfPosition(node.getStart(source));
      (row.sites[metric] ??= []).push(`${file}:${at.line + 1}:${at.character + 1}`);
    };
    const member = (type, name, node) => {
      const prop = checker.getPropertyOfType(type, name);
      if (prop === undefined) return;
      let classification = contextProperties.get(prop);
      if (classification === undefined) {
        const context = origin(prop, ['ShardContext', 'LevelContext']), decl = prop.valueDeclaration ?? prop.declarations?.[0];
        classification = { context, runtime: name === 'runtime' && origin(prop, ['GameServices']), nonData: context && decl !== undefined && !data(checker.getTypeOfSymbolAtLocation(prop, decl)) };
        contextProperties.set(prop, classification);
      }
      if (classification.context) {
        if (name === 'app' || name === 'game') add(`ctx.${name}`, node);
        if (classification.nonData) add(`context.${name}`, node);
      }
      if (classification.runtime) add('ctx.game.runtime', node);
    };
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && contextMembers.has(node.name.text)) member(checker.getTypeAtLocation(node.expression), node.name.text, node);
      else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && contextMembers.has(node.argumentExpression.text)) member(checker.getTypeAtLocation(node.expression), node.argumentExpression.text, node);
      else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name;
          if (!element.dotDotDotToken && (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && contextMembers.has(key.text)) member(checker.getTypeAtLocation(node.initializer), key.text, element);
        }
      } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        for (const clause of node.heritageClauses ?? []) if (clause.token === ts.SyntaxKind.ExtendsKeyword) for (const base of clause.types) {
          const type = checker.getTypeAtLocation(base), weapon = platformWeapon(type);
          const name = weapon ? 'Weapon' : engineBase(type);
          if (name !== null) {
            const entry = Object.entries(transfers).find(([original, item]) => (file === original || file === item.runtime) && node.name?.text === item.class);
            if (entry !== undefined) {
              const [original, transfer] = entry;
              if (!weapon || name !== transfer.base || existsSync(resolve(root, transfer.from))) throw new Error(`Invalid kit weapon transfer ${file}: platform base changed or kit source still exists`);
              if (claimedTransfers.has(original)) throw new Error(`Invalid kit weapon transfer ${file}: transfer reused by another class`);
              claimedTransfers.add(original);
              const at = source.getLineAndCharacterOfPosition(node.getStart(source));
              (row.transfers ??= []).push({ from: transfer.from, site: `${file}:${at.line + 1}:${at.character + 1}`, class: transfer.class, base: name });
            } else {
              add('engineSubclasses', node); add(`subclass.${name}`, node);
              const hash = createHash('sha256').update(node.getText(source)).digest('hex'), key = `${file}:${hash}`, move = moves[key];
              if (move !== undefined) {
                const baseDeclarations = type.getSymbol()?.declarations ?? [];
                const definedAt = baseDeclarations.find(decl => ts.isClassDeclaration(decl) || ts.isClassExpression(decl));
                const definedFile = definedAt === undefined ? null : local(definedAt.getSourceFile().fileName);
                const originalFile = Object.values(moves).find(item => item.to === definedFile)?.from ?? definedFile;
                if (move.to !== file || move.hash !== hash || move.name !== (node.name?.text ?? '<anonymous>') || move.base !== name || move.baseFile !== originalFile
                  || existsSync(resolve(root, move.from)) || usedMoves.has(key)) throw new Error(`Invalid verbatim class move ${key}`);
                usedMoves.add(key);
                (row.verbatimMoves ??= []).push({ from: move.from, site: key, base: name });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const key of Object.keys(moves)) if (!usedMoves.has(key)) throw new Error(`Unmatched verbatim class move ${key}; retire it before editing the class`);
  return shards;
}

/** A removed shard/member buys no allowance for another shard/member. */
export function compareCoupling(baseline, candidate) {
  const failures = [];
  for (const [slug, row] of Object.entries(candidate)) for (const [metric, count] of Object.entries(row.counts)) {
    const moved = value => (value?.verbatimMoves ?? []).filter(move => metric === 'engineSubclasses' || metric === `subclass.${move.base}`).length;
    const ceiling = (baseline[slug]?.counts[metric] ?? 0) - moved(baseline[slug]);
    const active = count - moved(row);
    if (!Number.isSafeInteger(count) || active < 0 || active > ceiling) failures.push(`${slug}: ${metric} rose ${ceiling} → ${active}`);
  }
  return failures;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const current = shardCoupling();
  if (process.argv.includes('--update')) {
    writeFileSync(resolve(ROOT, LIST), `${JSON.stringify({ about: 'SF2: legacy, pre-SF2 typed coupling ceilings; counts only shrink.', shards: current }, null, 2)}\n`);
  }
  if (process.argv.includes('--check')) {
    const recorded = JSON.parse(readFileSync(resolve(ROOT, LIST), 'utf8'));
    const failures = compareCoupling(recorded.shards, current);
    for (const failure of failures) console.error(`shard-coupling: ${failure}`);
    if (failures.length > 0) process.exitCode = 1;
  }
  console.log('shard                  ctx.app  ctx.game  game.runtime  engine subclasses  non-data context');
  for (const [slug, row] of Object.entries(current)) {
    const nonData = Object.entries(row.counts).filter(([metric]) => metric.startsWith('context.')).map(([metric, count]) => `${metric.slice(8)}=${count}`).join(', ');
    console.log(`${slug.padEnd(22)} ${String(row.counts['ctx.app']).padStart(7)} ${String(row.counts['ctx.game']).padStart(9)} ${String(row.counts['ctx.game.runtime']).padStart(13)} ${String(row.counts.engineSubclasses).padStart(18)}  ${nonData}`);
    for (const transfer of row.transfers ?? []) console.log(`  transferred ${transfer.class}: ${transfer.from} → ${transfer.site} (${transfer.base}; retires SF36)`);
  }
}
