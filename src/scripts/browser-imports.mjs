// J402: an executable import is distinct from a comment, example or type query.
import ts from '@typescript/typescript6';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/** @param {string} source @param {string} [filename] */
export function runtimePlaywrightImports(source,filename='source.ts'){
 const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);
 /** @type {number[]} */const found=[];
 const admissionNames=new Set(ast.statements.flatMap(statement=>{
  if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier)||!statement.moduleSpecifier.text.endsWith('/browser-machine-loader.mjs'))return [];
  const bindings=statement.importClause?.namedBindings;
  return bindings!==undefined&&ts.isNamedImports(bindings)?bindings.elements.filter(binding=>(binding.propertyName??binding.name).text==='admittedPlaywright').map(binding=>binding.name.text):[];
 }));
 const packages=new Set(['playwright','playwright-core','@playwright/test']);
 const safeRunnerValues=new Set(['expect','defineConfig','devices','errors']);
 /** @param {string} module @param {import('@typescript/typescript6').NamedImportBindings|import('@typescript/typescript6').NamedExportBindings|undefined} bindings */
 function authority(module,bindings){
  if(module!=='@playwright/test'||bindings===undefined||!('elements'in bindings))return true;
  return bindings.elements.some(binding=>!binding.isTypeOnly&&!safeRunnerValues.has((binding.propertyName??binding.name).text));
 }
 /** @param {import('@typescript/typescript6').Node} node */
 function visit(node){
  if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&packages.has(node.moduleSpecifier.text)&&node.importClause?.phaseModifier!==ts.SyntaxKind.TypeKeyword){
   const bindings=node.importClause?.namedBindings;
   if(authority(node.moduleSpecifier.text,bindings)&&(node.importClause?.name!==undefined||bindings===undefined||!ts.isNamedImports(bindings)||bindings.elements.length===0||bindings.elements.some(binding=>!binding.isTypeOnly)))found.push(node.moduleSpecifier.getStart(ast));
  }
  if(ts.isExportDeclaration(node)&&!node.isTypeOnly&&node.moduleSpecifier!==undefined&&ts.isStringLiteral(node.moduleSpecifier)&&packages.has(node.moduleSpecifier.text)&&authority(node.moduleSpecifier.text,node.exportClause))found.push(node.moduleSpecifier.getStart(ast));
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0])&&packages.has(node.arguments[0].text)){
   const parent=node.parent;
   if(!ts.isCallExpression(parent)||!ts.isIdentifier(parent.expression)||!admissionNames.has(parent.expression.text))found.push(node.arguments[0].getStart(ast));
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);return found;
}

/** The tracked source and current new source, before a commit or at clean CI HEAD.
 * @param {string} [root] */
export function unadmittedBrowserImports(root=process.cwd()){
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--','*.mjs','*.cjs','*.js','*.ts','*.mts'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 return [...new Set(files)].filter(file=>{
  if((file==='src/scripts/browser-playwright.mjs'||file==='src/scripts/browser-test.mjs'||file==='src/scripts/browser/playwright.mjs'||file==='src/scripts/browser/test.mjs')||file.startsWith('project/archive/'))return false;
  const source=readFileSync(resolve(root,file),'utf8');
  return source.includes('playwright')&&runtimePlaywrightImports(source,file).length>0;
 }).sort();
}
