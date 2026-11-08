import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import ts from '@typescript/typescript6';

interface Package {exports:Record<string,string>;dependencies:Record<string,string>}
export interface CookRevision {revision:string;files:readonly string[];node:string;brotli:string;format:string}

/** Actual runtime import walk of the byte producer, including literal worker URLs.
 * Proof execution is supplied by the host and is never a reusable verdict. */
export function cookRevision(root=resolve(import.meta.dirname,'..')):CookRevision {
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
        const types=clause?.phaseModifier===ts.SyntaxKind.TypeKeyword||clause?.name===undefined&&bindings!==undefined&&ts.isNamedImports(bindings)&&bindings.elements.every(row=>row.isTypeOnly);
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
  seen.add('scripts/cook-job.mjs');seen.add('scripts/cook-revision.ts');seen.add('pnpm-lock.yaml');
  const files=[...seen].sort(),node=process.versions.node.split('.')[0]??'',brotli=process.versions.brotli??'';
  const format=pkg.dependencies['@wildshard/format'];if(format===undefined)throw new Error('No pinned cook format');
  const hash=createHash('sha256').update(JSON.stringify({schema:'cook-revision/1',node,brotli,format}));
  for(const file of files)hash.update(file).update('\0').update(readFileSync(resolve(root,file))).update('\0');
  return {revision:hash.digest('hex'),files,node,brotli,format};
}
