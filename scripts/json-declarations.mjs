// Exact mutable JSON declarations: compiler-derived types, no runtime data rewrite.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, globSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from '@typescript/typescript6';

/** Retain managed sources across threshold changes and refuse orphaned types.
 * @param {string[]} tracked
 * @param {string[]} companions */
export function jsonDeclarationInputs(tracked, companions) {
  const managed = companions.filter(file => readFileSync(file, 'utf8').startsWith('// Compiler-derived from ')).map(file => {
    const json = file.replace(/\.d\.json\.ts$/u, '.json');
    if (!existsSync(json)) throw new Error(`Orphaned JSON declaration: ${file}`);
    if (json.includes('.generated.')) throw new Error(`Generated JSON must not have a companion: ${file}`);
    return json;
  });
  const large = tracked.filter(file => file !== '' && !file.includes('.generated.') && statSync(file).size > 256 * 1024);
  // A managed source stays checked even if its payload later shrinks below the
  // threshold; otherwise a stale companion would silently hide the new type.
  return [...new Set([...large, ...managed])].sort((a, b) => a.localeCompare(b));
}

/** Committed, non-generated compiler inputs above the LS7 size threshold. */
export function largeJsonInputs() {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src/shards/**/*.json', 'test/fixtures/*.json', 'test/fixtures/**/*.json',
    'public/assets/nine-dragon/authored/sign-atlas/signAtlas.json'], {encoding: 'utf8'}).split('\0');
  return jsonDeclarationInputs(tracked, globSync(['src/shards/**/*.d.json.ts', 'test/fixtures/**/*.d.json.ts']));
}

/** Derive the native import type; ignore existing companions during regeneration.
 * @param {string[]} files */
export function jsonDeclarations(files) {
  const paths = files.map(file => resolve(file));
  const companions = new Set(paths.map(file => `${file.slice(0, -5)}.d.json.ts`));
  const probe = resolve('.json-declarations-probe.ts');
  const source = paths.map((file, index) => `import value${index} from ${JSON.stringify(file)};`).join('\n');
  const options = { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, resolveJsonModule: true,
    allowSyntheticDefaultImports: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], lib: ['lib.es2022.d.ts'] };
  const host = ts.createCompilerHost(options), exists = host.fileExists.bind(host), get = host.getSourceFile.bind(host);
  host.fileExists = file => file === probe || !companions.has(file) && exists(file);
  host.getSourceFile = (file, language, onError, createNew) => file === probe
    ? ts.createSourceFile(file, source, typeof language === 'object' ? language.languageVersion : language, true)
    : get(file, language, onError, createNew);
  const program = ts.createProgram([probe], options, host), checker = program.getTypeChecker();
  const errors = ts.getPreEmitDiagnostics(program);
  if (errors.length > 0) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
  const unit = program.getSourceFile(probe);
  if (unit === undefined) throw new Error('Missing native JSON type probe');
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return files.map((file, index) => {
    const statement = unit.statements[index];
    if (statement === undefined || !ts.isImportDeclaration(statement) || statement.importClause?.name === undefined) throw new Error(`Missing JSON import: ${file}`);
    const type = checker.getTypeAtLocation(statement.importClause.name);
    const node = checker.typeToTypeNode(type, undefined, ts.NodeBuilderFlags.NoTruncation);
    if (node === undefined) throw new Error(`Cannot express complete JSON type: ${file}`);
    const shape = printer.printNode(ts.EmitHint.Unspecified, node, unit);
    if (/\bimport\s*\(/u.test(shape)) throw new Error(`JSON type must be self-contained: ${file}`);
    let nativeOnly = file.startsWith('public/'); // Never publish a type-only file as an asset.
    const inspect = current => { if (current.kind === ts.SyntaxKind.AnyKeyword || ts.isTypeLiteralNode(current) && current.members.length === 0) nativeOnly = true; ts.forEachChild(current, inspect); };
    inspect(node);
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    return { file: `${file.slice(0, -5)}.d.json.ts`, json: file, hash,
      declaration: nativeOnly ? null : `// Compiler-derived from ${file}; sha256 ${hash}.\n// Refresh: node scripts/json-declarations.mjs\ndeclare const value: ${shape};\n// oxlint-disable-next-line import/no-default-export -- native JSON requires its default import contract\nexport default value;\n` };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = process.argv.slice(2), check = args.length === 1 && args[0] === '--check';
  if (args.length > 0 && !check) throw new Error('Expected no arguments or --check');
  const rows = jsonDeclarations(largeJsonInputs());
  for (const row of rows) {
    if (row.declaration === null) {
      if (existsSync(row.file)) throw new Error(`Native-only JSON must not have a companion: ${row.json}`);
      continue;
    }
    if (check) {
      if (readFileSync(row.file, 'utf8') !== row.declaration) throw new Error(`Stale JSON declaration: ${row.file}`);
    } else writeFileSync(row.file, row.declaration);
  }
  for (const config of ['tsconfig.shards.json', 'test/tsconfig.json']) {
    const input = ts.parseConfigFileTextToJson(config, readFileSync(config, 'utf8'));
    if (input.error) throw new Error(`Invalid config: ${config}`);
    const data = input.config;
    const prefix = config === 'tsconfig.shards.json' ? 'src/shards/' : 'test/';
    const excluded = rows.filter(row => row.declaration !== null && row.json.startsWith(prefix))
      .map(row => relative(resolve(config, '..'), resolve(row.json)).replaceAll('\\', '/'));
    const native = rows.filter(row => row.declaration === null && row.json.startsWith(prefix))
      .map(row => relative(resolve(config, '..'), resolve(row.json)).replaceAll('\\', '/'));
    const shadowed = native.filter(file => data.exclude.includes(file));
    if (check && shadowed.length > 0) throw new Error(`Native JSON unexpectedly excluded: ${shadowed.join(', ')}`);
    if (!check) data.exclude = data.exclude.filter(file => !native.includes(file));
    const missing = excluded.filter(file => !data.exclude.includes(file));
    if (check && missing.length > 0) throw new Error(`JSON companion inputs still rooted in ${config}: ${missing.join(', ')}`);
    if (!check && (missing.length > 0 || shadowed.length > 0)) { data.exclude.push(...missing); writeFileSync(config, `${JSON.stringify(data, null, 2)}\n`); }
  }
  console.info(`JSON declarations: ${rows.filter(row => row.declaration !== null).length}; native fallbacks: ${rows.filter(row => row.declaration === null).length}`);
}
