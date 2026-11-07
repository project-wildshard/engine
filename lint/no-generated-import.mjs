// GR0: import spelling and declared paths only; no TypeScript program.
import {existsSync,readFileSync} from 'node:fs';
import {dirname,resolve,relative,sep} from 'node:path';

const text=node=>node?.type==='Literal'&&typeof node.value==='string'?node.value
  :node?.type==='TemplateLiteral'&&node.expressions.length===0?node.quasis[0]?.value.cooked:undefined;
const clean=value=>value.split(/[?#]/u)[0];
/** Keep catalogue lookup separate from the parser so immutable Git audits and
 * tiny fixtures use the same declared-output boundary. */
function importTargets(root,snapshot){
  const packages=new Map();
  const has=path=>snapshot===undefined?existsSync(path):snapshot.files.has(relative(root,path).split(sep).join('/'));
  function target(file,specifier){
    const path=clean(specifier);
    if(path.startsWith('.'))return [relative(root,resolve(dirname(resolve(root,file)),path)).split(sep).join('/')];
    if(path.startsWith('/src/'))return [path.slice(1)];
    const match=/^@wildshard\/(engine|format|game|sdk|sharddev|commons)(?:\/(.*))?$/u.exec(path);
    const packageName=match?.at(1);
    if(packageName===undefined)return [path];
    let exports=packages.get(packageName);
    if(exports===undefined){
      const source=resolve(root,'src',packageName,'package.json');
      exports=has(source)?JSON.parse(snapshot===undefined?readFileSync(source,'utf8'):snapshot.read(relative(root,source).split(sep).join('/'))).exports??{}:{};packages.set(packageName,exports);
    }
    const subpath=match?.at(2),key=subpath===undefined?'.':`./${subpath}`;
    let entry=exports[key],capture='';
    if(entry===undefined)for(const [pattern,value]of Object.entries(exports)){
      const star=pattern.indexOf('*');if(star===-1)continue;
      const prefix=pattern.slice(0,star),suffix=pattern.slice(star+1);
      if(key.startsWith(prefix)&&key.endsWith(suffix)){entry=value;capture=key.slice(prefix.length,key.length-suffix.length);break;}
    }
    const values=[],pending=[entry];
    while(pending.length>0){
      const value=pending.pop();
      if(typeof value==='string')values.push(relative(root,resolve(root,'src',packageName,value.replaceAll('*',capture))).split(sep).join('/'));
      else if(value!==null&&typeof value==='object')pending.push(...Object.values(value));
    }
    return values.length>0?values:[path];
  }

  return target;
}
export function generatedImportContext(root,files,sources=[]){
  const outputs=new Set(files),authored=new Set(sources),target=importTargets(root);
  return (file,specifier)=>{
    const resolved=target(file,specifier);
    return resolved.some(path=>{const candidates=[path,...['.ts','.tsx','.mts','.cts','.js','.mjs','.cjs','.json'].map(extension=>path+extension)];
      return !candidates.some(candidate=>authored.has(candidate))
        &&(/\.generated(?:\.|$)/u.test(path)||candidates.some(candidate=>outputs.has(candidate)));});
  };
}
/** Existing registered producers are data, not an executable discovery/build. */
export function generatedOutputPaths(root){
  const files=new Set();
  const sources=resolve(root,'scripts/source-generation-outputs.json');
  if(existsSync(sources))for(const rows of Object.values(JSON.parse(readFileSync(sources,'utf8')).producers))for(const file of rows)files.add(file);
  return files;
}
/** Every actual import form, including type imports and literal dynamic loads. */
export function generatedImportVisitors(check){
  const source=(node,value)=>{const specifier=text(value);if(specifier!==undefined)check(node,specifier);};
  return {
    ImportDeclaration(node){source(node,node.source);},
    ExportNamedDeclaration(node){source(node,node.source);},
    ExportAllDeclaration(node){source(node,node.source);},
    ImportExpression(node){source(node,node.source);},
    TSImportType(node){source(node,node.source);},
    CallExpression(node){if(node.callee.type==='Identifier'&&node.callee.name==='require')source(node,node.arguments[0]);},
  };
}
export function noGeneratedImportRule(root,policyFile){
  const policy=existsSync(policyFile)?JSON.parse(readFileSync(policyFile,'utf8')):{files:{}};
  const generated=generatedImportContext(root,generatedOutputPaths(root),policy.sources??[]);
  return {meta:{type:'problem',docs:{description:'Call authoring functions or read admitted products, never import a generated output (GR0)'},
    schema:[{type:'object',properties:{count:{type:'boolean'}},additionalProperties:false}]},
    create(context){
      const file=relative(root,context.filename).split(sep).join('/');
      if(!/^(?:src|test)\//u.test(file))return {};
      const limit=context.options[0]?.count===true?0:Object.hasOwn(policy.files,file)?policy.files[file]:0;
      let found=0;
      return generatedImportVisitors((node,specifier)=>{
        if(generated(file,specifier)&&++found>limit)context.report({node,message:'NO-GENERATED-IMPORT: call the authoring function or read the admitted product (GR0)'});
      });
    }};
}

/** G8 is independent of the retiring scheduler and its authored-TS exemptions. */
export function generatedJsonImportContext(root,snapshot){
  const target=importTargets(root,snapshot);
  const has=path=>snapshot===undefined?existsSync(resolve(root,path)):snapshot.files.has(path);
  return (file,specifier)=>target(file,specifier).some(path=>{
    if(path.endsWith('.generated.json'))return true;
    return path.endsWith('.generated')&&has(`${path}.json`)
      && !['.ts','.tsx','.mts','.cts','.js','.mjs','.cjs'].some(extension=>has(path+extension));
  });
}
/** Generated-JSON imports start at today's exact per-file count, including tools/tests. */
export function noGeneratedJsonImportRule(root,limits,snapshot){
  const generated=generatedJsonImportContext(root,snapshot);
  const allowed=limits??{};
  return {meta:{type:'problem',docs:{description:'Read and validate generated JSON headers as data, never import payloads into TypeScript (G8)'},
    schema:[{type:'object',properties:{count:{type:'boolean'}},additionalProperties:false}]},
    create(context){
      const file=relative(root,context.filename).split(sep).join('/');
      if(file.startsWith('../')||file.includes('/node_modules/'))return {};
      const count=context.options[0]?.count===true;
      const limit=count?0:Object.hasOwn(allowed,file)?allowed[file]:0;
      if(!Number.isSafeInteger(limit)||limit<0)throw new Error(`Invalid generated-JSON import count: ${file}`);
      let found=0;
      return generatedImportVisitors((node,specifier)=>{
        if(generated(file,specifier)&&++found>limit)context.report({node,message:'NO-GENERATED-JSON-IMPORT: read the small header and validate it at run time (G8)'});
      });
    }};
}
