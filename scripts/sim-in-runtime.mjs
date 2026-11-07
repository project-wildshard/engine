// G453: runtime/ is client-only. Today's native reach is transitional debt, never a new code path.
import {existsSync,readFileSync,readdirSync,globSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseSync} from 'vite';

const ROOT=resolve(import.meta.dirname,'..');
const code=/\.[cm]?[jt]sx?$/u;
const text=node=>node?.type==='Literal'&&typeof node.value==='string'?node.value
 :node?.type==='TemplateLiteral'&&node.expressions.length===0?node.quasis[0]?.value.cooked:null;
const sorted=values=>[...values].sort((a,b)=>a.localeCompare(b));

/** Conservative module-level value reach, not a statement-level sim classifier.
 * Roots are the actual runtime/headless.ts native entry convention used by the
 * worker/grid proof callers, plus any exported prepareHeadlessRuntime factory
 * and static headlessModules catalogues. Declared assembly modules remain
 * roots when a build generates the catalogue outside source, so renamed or
 * generated entries cannot hide existing runtime installer dependencies.
 * Traversal stays within the shard; platform packages are hosts, not shard code.
 * Type-only edges erase at build and provide no executable reach. Lazy imports,
 * require and literal globs count; unprovable computed edges refuse the census.
 * @param {string} root
 * @returns {Record<string,{entries:string[],files:string[]}>} */
export function simRuntimeInventory(root=ROOT) {
 const result={};
 for(const entry of existsSync(resolve(root,'src/shards'))?readdirSync(resolve(root,'src/shards'),{withFileTypes:true}):[]) {
  if(!entry.isDirectory())continue;
  const prefix=`src/shards/${entry.name}/`,all=[];
  const scan=folder=>{for(const item of readdirSync(resolve(root,folder),{withFileTypes:true})){
   const path=`${folder}/${item.name}`;
   if(item.isSymbolicLink())throw new Error(`sim-in-runtime: source symlink ${path}`);
   if(item.isDirectory())scan(path);else if(code.test(path)&&!path.endsWith('.d.ts'))all.push(path);
  }};
  scan(prefix.slice(0,-1));
  const parsed=new Map();
  const ast=path=>{
   if(!parsed.has(path)){
    const value=parseSync(path,readFileSync(resolve(root,path),'utf8'));
    if(value.errors.length>0)throw new Error(`sim-in-runtime: cannot parse ${path}: ${value.errors[0].message}`);
    parsed.set(path,value.program);
   }
   return parsed.get(path);
  };
  const entries=all.filter(path=>path===`${prefix}runtime/headless.ts`||ast(path).body.some(node=>{
   if(node.type!=='ExportNamedDeclaration'||node.exportKind==='type')return false;
   const decl=node.declaration;
   return decl?.id?.name==='prepareHeadlessRuntime'||decl?.declarations?.some(row=>['prepareHeadlessRuntime','headlessModules'].includes(row.id?.name))===true
    ||node.specifiers.some(row=>row.exported?.name==='prepareHeadlessRuntime'&&row.exportKind!=='type');
  }));
  const assembly=resolve(root,prefix,'data/headlessAssembly.json');
  if(existsSync(assembly)){
   const declaration=JSON.parse(readFileSync(assembly,'utf8'));
   if(declaration.version!==1||declaration.modules===null||typeof declaration.modules!=='object'||Array.isArray(declaration.modules))throw new Error(`sim-in-runtime: invalid declared assembly ${assembly}`);
   for(const specifier of Object.keys(declaration.modules)){
    if(!specifier.startsWith(prefix)||/\.[^/]+$/u.test(specifier)&&!code.test(specifier))continue;
    const target=[specifier,`${specifier}.ts`,`${specifier}.tsx`,`${specifier}.mjs`,`${specifier}.js`,`${specifier}/index.ts`].find(file=>all.includes(file));
    if(target===undefined)throw new Error(`sim-in-runtime: unresolved declared assembly module ${specifier}`);
    if(!entries.includes(target))entries.push(target);
   }
  }
  const seen=new Set(),queue=[...entries];
  while(queue.length>0){
   const path=queue.pop();if(seen.has(path))continue;seen.add(path);
   const add=specifier=>{
    if(typeof specifier!=='string')throw new Error(`sim-in-runtime: computed import in ${path}`);
    if(!specifier.startsWith('.')){
     if(specifier.startsWith('src/shards/')||specifier.startsWith('/src/shards/'))throw new Error(`sim-in-runtime: use a closed relative shard import in ${path}`);
     return;
    }
    const base=relative(root,resolve(root,dirname(path),specifier.replace(/[?#].*$/u,''))).replaceAll('\\','/');
    if(!base.startsWith(prefix))return; // Other shard/layer reach is checked by check-graph.
    if(/\.[^/]+$/u.test(base)&&!code.test(base))return; // JSON/blobs/Wasm are data, not TS runtime debt.
    const stem=base.replace(/\.js$/u,'');
    const target=[base,`${stem}.ts`,`${stem}.tsx`,`${stem}.mjs`,`${stem}.js`,`${stem}/index.ts`].find(file=>code.test(file)&&existsSync(resolve(root,file)));
    if(target===undefined)throw new Error(`sim-in-runtime: unresolved value import ${path} -> ${specifier}`);
    if(!target.endsWith('.d.ts'))queue.push(target);
   };
   const walk=node=>{
    if(node===null||typeof node!=='object')return;
    if(node.type==='ImportDeclaration'){
     if(node.importKind!=='type'&&(node.specifiers.length===0||node.specifiers.some(row=>row.importKind!=='type')))add(text(node.source));
     return;
    }
    if(node.type==='ExportNamedDeclaration'||node.type==='ExportAllDeclaration'){
     if(node.exportKind==='type')return;
     if(node.source!==null&&node.source!==undefined){
      if(node.type==='ExportAllDeclaration'||node.specifiers.some(row=>row.exportKind!=='type'))add(text(node.source));return;
     }
    }
    if(node.type==='ImportExpression')add(text(node.source));
    if(node.type==='CallExpression'){
     if(node.callee.type==='Identifier'&&node.callee.name==='require')add(text(node.arguments[0]));
     if(node.callee.type==='MemberExpression'&&['glob','globEager'].includes(node.callee.property?.name)
      &&node.callee.object?.type==='MetaProperty'&&node.callee.object.meta.name==='import'){
      const raw=node.arguments[0],patterns=raw?.type==='ArrayExpression'?raw.elements:[raw],included=new Set(),excluded=new Set();
      for(const pattern of patterns){
       const value=text(pattern);if(typeof value!=='string')throw new Error(`sim-in-runtime: computed glob in ${path}`);
       const negative=value.startsWith('!'),spec=negative?value.slice(1):value;
       if(!spec.startsWith('.'))throw new Error(`sim-in-runtime: glob must be shard-relative in ${path}`);
       const patternPath=relative(root,resolve(root,dirname(path),spec)).replaceAll('\\','/');
       for(const file of globSync(patternPath,{cwd:root}))if(file.startsWith(prefix)&&code.test(file))(negative?excluded:included).add(file);
      }
      for(const file of included)if(!excluded.has(file)&&!file.endsWith('.d.ts'))queue.push(file);
     }
    }
    // Import types do not execute; assertions/satisfies may still wrap live expressions.
    if(node.type==='TSImportType'||node.type==='TSInterfaceDeclaration'||node.type==='TSTypeAliasDeclaration')return;
    for(const [key,value]of Object.entries(node)){
     if(key==='parent'||key==='comments')continue;
     if(Array.isArray(value))for(const child of value)walk(child);else if(value!==null&&typeof value==='object')walk(value);
    }
   };
   walk(ast(path));
  }
  result[entry.name]={entries:sorted(entries),files:sorted([...seen].filter(path=>path.startsWith(`${prefix}runtime/`)))};
 }
 return result;
}

/** Exact file identities and counts shrink together: no replacement file can borrow freed room.
 * @param {{budgets?:Record<string,number>,allow?:Record<string,Record<string,string>>}} policy
 * @param {ReturnType<typeof simRuntimeInventory>} inventory */
export function simRuntimeFailures(policy,inventory) {
 const failures=[],allowed=policy.allow?.['shardfile/sim-in-runtime']??{},current=new Set();
 for(const [slug,row]of Object.entries(inventory)){
  const ceiling=policy.budgets?.[`sim-in-runtime/${slug}`],count=row.files.length;
  if(!Number.isSafeInteger(ceiling)||ceiling<0)failures.push(`${slug}: missing sim-in-runtime baseline`);
  else if(count>ceiling)failures.push(`${slug}: sim-in-runtime files ${count} exceeds ${ceiling}`);
  else if(count<ceiling)failures.push(`${slug}: lower sim-in-runtime baseline ${ceiling} to ${count}`);
  for(const path of row.files){current.add(path);if(!Object.hasOwn(allowed,path))failures.push(`${path}: new sim-in-runtime file; move server logic to sections/hosts or Wasm (G453)`);}
 }
 for(const path of Object.keys(allowed))if(!current.has(path))failures.push(`${path}: remove retired sim-in-runtime allowance (G453)`);
 return failures;
}

/** Enforced by check-graph in the immutable commit mirror, push gate and CI. */
export function checkSimRuntime(root=ROOT) {
 const inventory=simRuntimeInventory(root),policy=JSON.parse(readFileSync(resolve(root,'lint/ratchet.json'),'utf8'));
 return simRuntimeFailures(policy,inventory);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const inventory=simRuntimeInventory();
 if(process.argv.includes('--json'))console.log(JSON.stringify(inventory,null,2));
 else{const failures=checkSimRuntime();for(const message of failures)console.error(`sim-in-runtime: ${message}`);process.exitCode=failures.length>0?1:0;}
}
