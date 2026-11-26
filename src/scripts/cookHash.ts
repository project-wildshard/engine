import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {isBuiltin} from 'node:module';

interface Package {exports:Record<string,string>;dependencies:Record<string,string>}
export interface CookHash {cookHash:string;files:readonly string[];node:string;brotli:string;format:string}

/** Actual runtime import walk of the byte producer, including literal worker URLs.
 * Proof execution is supplied by the host and is never a reusable verdict. */
export function cookHash(checkout=resolve(import.meta.dirname,'..', '..'),read:(path:string)=>Uint8Array=readFileSync):CookHash {
  // QA 11-23 row 7: cook-worker.mjs passes `fileURLToPath(new URL('../..', import.meta.url))`, which ends in `/`, so every
  // closure file failed the escape check below and the box worker never had a cook revision: every build recooked every head.
  const root=resolve(checkout);
  const pkg=JSON.parse(new TextDecoder().decode(read(resolve(root,'package.json')))) as Package;
  const pending = ['src/cook/game/cookJob.ts', 'src/cook/game/cookWorker.ts', 'src/scripts/cook-job.mjs'];
  const seen = new Set<string>();
  const outside = (name: string): boolean => name === 'package.json' || name === 'src/scripts/renderer-revision.mjs'
    || name === 'src/server/host/checkShardfile.ts' || name.startsWith('src/client/');
  const external = new Set(['@typescript/typescript6']);
  const sourceFile=(specifier:string,from:string):string|null=>{
    if (isBuiltin(specifier)) return null;
    let target:string;
    if(specifier.startsWith('.'))target=resolve(dirname(from),specifier);
    else if(specifier.startsWith('@wildshard/engine/')) {
      const mapped=pkg.exports[`./${specifier.slice('@wildshard/engine/'.length)}`];
      if(mapped===undefined)throw new Error(`Unresolved engine cook import: ${specifier}`);
      target=resolve(root,mapped);
    } else if(specifier.startsWith('#'))throw new Error(`Unresolved cook import: ${specifier}`);
    else {
      const components = specifier.split('/');
      external.add(components.slice(0, specifier.startsWith('@') ? 2 : 1).join('/'));
      return null;
    }
    if (outside(relative(root, target))) return null;
    for(const candidate of [target,...['.ts','.mjs','.js','.json','/index.ts'].map(suffix=>target+suffix)])
      if(existsSync(candidate)&&statSync(candidate).isFile())return candidate;
    throw new Error(`Unresolved cook file: ${specifier} from ${relative(root,from)}`);
  };
  while(pending.length>0) {
    const name=pending.pop();
    if (name === undefined || seen.has(name) || outside(name)) continue;
    const file=resolve(root,name);if(!file.startsWith(`${root}/`))throw new Error('Cook closure escapes its source root');
    seen.add(name);
    if (!/\.[cm]?[jt]s$/u.test(name)) continue;
    const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const follow=(specifier:string):void=>{const target=sourceFile(specifier,file);if(target!==null)pending.push(relative(root,target));};
    const visit=(node:ts.Node):void=>{
      if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)) {
        const clause=node.importClause;
        const bindings=clause?.namedBindings;
        const types=clause?.phaseModifier===ts.SyntaxKind.TypeKeyword||clause?.name===undefined&&bindings!==undefined&&ts.isNamedImports(bindings)&&bindings.elements.length>0&&bindings.elements.every(row=>row.isTypeOnly);
        if(!types)follow(node.moduleSpecifier.text);
      } else if(ts.isExportDeclaration(node)&&node.moduleSpecifier!==undefined&&ts.isStringLiteral(node.moduleSpecifier)&&!node.isTypeOnly)follow(node.moduleSpecifier.text);
      else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        const argument=node.arguments[0];if(argument===undefined||!ts.isStringLiteral(argument))throw new Error(`Dynamic cook import or require in ${name}`);
        follow(argument.text);
      } else if(ts.isNewExpression(node)&&node.expression.getText(source)==='URL'&&node.arguments?.[1]?.getText(source)==='import.meta.url') {
        const argument=node.arguments[0];if(argument===undefined||!ts.isStringLiteral(argument))throw new Error(`Dynamic cook worker URL in ${name}`);
        if (argument.text !== '.' && argument.text !== './') follow(argument.text.startsWith('.') ? argument.text : './' + argument.text);
      }
      ts.forEachChild(node,visit);
    };
    visit(source);
  }
  // Host hooks shape the code the separate cook child can load. Their app bootstrap is not a byte producer.
  for (const file of ['src/scripts/bake-loader.mjs', 'src/scripts/format-hook.mjs']) seen.add(file);
  const format = pkg.dependencies['@wildshard/format'];
  if (format === undefined) throw new Error('No pinned cook format');
  const files = [...seen].sort(), node = process.versions.node.split('.')[0] ?? '', brotli = process.versions['brotli'] ?? '';
  const lockfile = new TextDecoder().decode(read(resolve(root, 'pnpm-lock.yaml')));
  const pins = [...external].sort().map(name => [name, lockEntry(lockfile, name)]);
  const hash = createHash('sha256').update(JSON.stringify({schema: 'cook-hash/1', format, pins}));
  for (const file of files) hash.update(file).update('\0').update(read(resolve(root, file))).update('\0');
  return {cookHash: hash.digest('hex'), files, node, brotli, format};
}

/** Root pnpm importer rows include the selected version of a dependency and its peers. */
function lockEntry(lock: string, name: string): string {
  const importer = lock.split('\npackages:')[0] ?? '';
  const lines = importer.split('\n');
  const at = lines.findIndex(line => line === `      ${name}:` || line === `      '${name}':`);
  const version = at < 0 ? undefined : /^        version: (.+)$/u.exec(lines[at + 2] ?? '')?.[1];
  if (version === undefined) throw new Error(`No locked cook dependency: ${name}`);
  return version;
}
