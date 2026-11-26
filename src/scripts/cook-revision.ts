import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {rendererRevision} from './renderer-revision.mjs';

interface Package {exports:Record<string,string>;dependencies:Record<string,string>}
export interface CookRevision {revision:string;files:readonly string[];node:string;brotli:string;format:string;renderer:string}

/** Actual runtime import walk of the byte producer, including literal worker URLs.
 * Proof execution is supplied by the host and is never a reusable verdict. */
export function cookRevision(checkout=resolve(import.meta.dirname,'..', '..'),read:(path:string)=>Uint8Array=readFileSync):CookRevision {
  // QA 11-23 row 7: cook-worker.mjs passes `fileURLToPath(new URL('../..', import.meta.url))`, which ends in `/`, so every
  // closure file failed the escape check below and the box worker never had a cook revision: every build recooked every head.
  const root=resolve(checkout);
  const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')) as Package;
  const pending=['src/cook/game/cookJob.ts'],seen=new Set<string>();
  const sourceFile=(specifier:string,from:string):string|null=>{
    if(specifier.startsWith('node:'))return null;
    let target:string;
    if(specifier.startsWith('.'))target=resolve(dirname(from),specifier);
    else if(specifier.startsWith('@wildshard/engine/')) {
      const mapped=pkg.exports[`./${specifier.slice('@wildshard/engine/'.length)}`];
      if(mapped===undefined)throw new Error(`Unresolved engine cook import: ${specifier}`);
      target=resolve(root,mapped);
    } else if(specifier.startsWith('#'))throw new Error(`Unresolved cook import: ${specifier}`);
    else return null; // External code and codecs are pinned by the frozen lock below.
    for(const candidate of [target,...['.ts','.mjs','.js','.json','/index.ts'].map(suffix=>target+suffix)])
      if(existsSync(candidate)&&statSync(candidate).isFile())return candidate;
    throw new Error(`Unresolved cook file: ${specifier} from ${relative(root,from)}`);
  };
  while(pending.length>0) {
    const name=pending.pop();if(name===undefined||seen.has(name))continue;
    const file=resolve(root,name);if(!file.startsWith(`${root}/`))throw new Error('Cook closure escapes its source root');
    seen.add(name);
    if(name.endsWith('.json'))continue;
    const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const follow=(specifier:string):void=>{const target=sourceFile(specifier,file);if(target!==null)pending.push(relative(root,target));};
    const visit=(node:ts.Node):void=>{
      if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)) {
        const clause=node.importClause;
        const bindings=clause?.namedBindings;
        const types=clause?.phaseModifier===ts.SyntaxKind.TypeKeyword||clause?.name===undefined&&bindings!==undefined&&ts.isNamedImports(bindings)&&bindings.elements.length>0&&bindings.elements.every(row=>row.isTypeOnly);
        if(!types)follow(node.moduleSpecifier.text);
      } else if(ts.isExportDeclaration(node)&&node.moduleSpecifier!==undefined&&ts.isStringLiteral(node.moduleSpecifier)&&!node.isTypeOnly)follow(node.moduleSpecifier.text);
      else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword) {
        const argument=node.arguments[0];if(argument===undefined||!ts.isStringLiteral(argument))throw new Error(`Dynamic cook import in ${name}`);
        follow(argument.text);
      } else if(ts.isNewExpression(node)&&node.expression.getText(source)==='URL'&&node.arguments?.[1]?.getText(source)==='import.meta.url') {
        const argument=node.arguments[0];if(argument===undefined||!ts.isStringLiteral(argument))throw new Error(`Dynamic cook worker URL in ${name}`);
        if(argument.text!=='.'&&argument.text!=='./')follow(argument.text);
      }
      ts.forEachChild(node,visit);
    };
    visit(source);
  }
  // Host encoder wiring is an input; its injected simulation prover is not the byte producer.
  seen.add('src/scripts/cook-job.mjs');seen.add('src/scripts/cook-revision.ts');seen.add('pnpm-lock.yaml');
  // The actual permission-limited child always loads these hooks. Its
  // renderer input also decides whether author preparation can be reused.
  seen.add('src/scripts/bake-loader.mjs');seen.add('src/scripts/format-hook.mjs');
  const {brotli=''}=process.versions;
  const files=[...seen].sort(),node=process.versions.node.split('.')[0]??'';
  const format=pkg.dependencies['@wildshard/format'];if(format===undefined)throw new Error('No pinned cook format');
  const renderer=rendererRevision(root);
  const hash=createHash('sha256').update(JSON.stringify({schema:'cook-revision/2',node,brotli,format,renderer}));
  for(const file of files)hash.update(file).update('\0').update(revisionBytes(file,read(resolve(root,file)))).update('\0');
  return {revision:hash.digest('hex'),files,node,brotli,format,renderer};
}

/** Meta QA 11-24 row 44 (MA14b): FP47b's engine floor (`src/cook/game/engineFloor.ts`) reads package.json's version through
 * a literal `new URL`, so the closure took package.json whole, and every release's version bump moved the cook revision:
 * v0.1.89 `338d2aad` to v0.1.90 `b0ef8f85` with no other input changed, so the box queued all 38 heads and carried none.
 * The cook reads only `version` from it, and the version never changes a passing cook: it only refuses a product whose
 * floor is above it, a release only rises, and `carry` copies passing indexes only. Its dependencies are the lockfile's
 * and the format pin's (both hashed), its `exports` decide only which files join the closure (their names and bytes are
 * hashed). So package.json adds nothing: a version bump, an `engines` pin (QA 11-25 row 41) or a script edit keeps the
 * revision, and every head carries. */
export function revisionBytes(file:string,bytes:Uint8Array):Uint8Array {
  return file==='package.json'?new Uint8Array(0):bytes;
}
