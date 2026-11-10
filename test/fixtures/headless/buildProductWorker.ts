// A fixed test-only compiler process. Set Rolldown/Rayon pool sizes before startup;
// https://github.com/rolldown/rolldown/blob/main/docs/guide/troubleshooting.md
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the actual bytes supplied to the compiler.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Read only fixed source/dependency inputs and their resolution metadata.
import {existsSync,readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Select the same installed Rapier binding as the normal server build.
import {createRequire} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixed entries within the private source root.
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {build} from 'rolldown';

const digest=(bytes:Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');

async function compile(root:string,directory:string):Promise<{
  inputs:{file:string;hash:string|null}[];outputs:{file:string;hash:string}[];
}>{
  const require=createRequire(resolve(root,'package.json')),inputs=new Map<string,string|undefined>();
  const remember=(file:string,bytes:Uint8Array):void=>{
    const hash=digest(bytes),prior=inputs.get(file);
    if(inputs.has(file)&&prior!==hash)throw new Error('Headless preparation source changed during compilation');
    inputs.set(file,hash);
  };
  remember(import.meta.filename,readFileSync(import.meta.filename));
  for(const file of ['package.json','pnpm-lock.yaml'])remember(resolve(root,file),readFileSync(resolve(root,file)));
  remember(require.resolve('rolldown/package.json'),readFileSync(require.resolve('rolldown/package.json')));
  const packages=new Set<string>();
  const packageAt=(file:string):void=>{
    let at=dirname(file);
    while(!packages.has(at)){
      packages.add(at);
      const metadata=resolve(at,'package.json');
      if(existsSync(metadata)){remember(metadata,readFileSync(metadata));return;}
      inputs.set(metadata,undefined);
      const parent=dirname(at);if(parent===at)return;at=parent;
    }
  };
  const verify=(files:ReadonlyMap<string,string|undefined>,message:string):void=>{
    for(const [file,hash]of files){
      if(hash===undefined){if(!existsSync(file))continue;}
      else try{if(digest(readFileSync(file))===hash)continue;}catch{/* Missing inputs and outputs both refuse. */}
      throw new Error(message);
    }
  };

  for(const [name,entry]of [['headless','src/server/host/headless.ts'],['headlessWorker','src/server/host/bake/headlessWorker.ts']] as const){
      const bundle=await build({cwd:root,input:resolve(root,entry),platform:'node',transform:{target:'node24'},plugins:[{
        name:'fixed-product-worker',
        resolveId(source){
          if(/^\.\/rapier_wasm3d(?:\.js)?$/u.test(source))return resolve(root,'src/server/engine/physics/rapierBindings.ts');
          if(source==='@dimforge/rapier3d-simd')return require.resolve('@dimforge/rapier3d-simd/rapier.js');
          return null;
        },
        load(id){
          if(!isAbsolute(id)||!/\.(?:[cm]?[jt]sx?|json)$/u.test(id))return null;
          const bytes=readFileSync(id);remember(id,bytes);packageAt(id);
          return {code:bytes.toString('utf8')};
        },
      }],external:['pg-native'],output:{file:resolve(directory,`${name}.js`),format:'esm',codeSplitting:false,minify:false}});
      if(bundle.output.length!==1||bundle.output.some(row=>row.type!=='chunk'||row.fileName!==`${name}.js`))throw new Error('Headless preparation must emit one self-contained entry');
    }
  verify(inputs,'Headless preparation source changed');
    const outputs=new Map(['headless.js','headlessWorker.js'].map(name=>{
      const file=resolve(directory,name);return [file,digest(readFileSync(file))] as const;
    }));
    return {inputs:[...inputs].map(([file,hash])=>({file,hash:hash??null})),outputs:[...outputs].map(([file,hash])=>({file,hash}))};
}

const [root,directory,...extra]=process.argv.slice(2);
if(root===undefined||directory===undefined||extra.length!==0||!isAbsolute(root)||dirname(directory)!==resolve(root,'tmp')||!basename(directory).startsWith('compiled-product-'))throw new Error('Expected an owned fixed-worker compilation');
console.info(JSON.stringify(await compile(root,directory)));
