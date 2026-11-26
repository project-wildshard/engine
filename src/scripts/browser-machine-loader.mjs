// Portable tools discover one owned machine provider. Missing policy is
// portable; an unsafe or broken present policy refuses admission.
import {constants,existsSync} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const MAX_BYTES=4096,READ_BYTES=4097,START=0,PRIVATE_MODE_BASE=0o100,SCHEMA_VERSION=1;
/** @typedef {import('./browser-machine-loader.d.mts').BrowserPolicyRecord} BrowserPolicyRecord */
/** @typedef {import('./browser-machine-loader.d.mts').BrowserMachineOptions} BrowserMachineOptions */
/** @typedef {import('./browser-machine-loader.d.mts').BrowserMachineProvider} BrowserMachineProvider */

/** @param {string} filename */
async function policyOpen(filename){
 if(typeof constants.O_NOFOLLOW!=='number'){
  await lstat(filename); // Missing policy remains portable on hosts without this flag.
  throw new Error('A present browser policy requires no-follow filesystem support');
 }
 return open(filename,constants.O_RDONLY+constants.O_NOFOLLOW);
}
/** @param {import('node:fs/promises').FileHandle} file @returns {Promise<BrowserPolicyRecord>} */
async function policyRecord(file){
 const stat=await file.stat();
 if(stat.size>MAX_BYTES){throw new Error('Browser admission policy exceeds its size limit');}
 const buffer=Buffer.alloc(READ_BYTES),{bytesRead}=await file.read(buffer,START,buffer.length,START);
 if(bytesRead>MAX_BYTES){throw new Error('Browser admission policy exceeds its size limit');}
 return{bytes:buffer.subarray(START,bytesRead).toString('utf8'),uid:stat.uid,mode:stat.mode,regular:stat.isFile()};
}
/** @param {string} filename @returns {Promise<BrowserPolicyRecord>} */
async function readPolicy(filename){
 const file=await policyOpen(filename);
 try{return await policyRecord(file);}finally{await file.close();}
}

/** @param {BrowserMachineOptions} options */
function policyFile(options){return options.path??path.join(homedir(),'.config','wildshard','browser-admission.json');}
/** @param {BrowserMachineOptions} options */
async function optionalPolicy(options){
 const filename=policyFile(options);
 try{return await(options.read??readPolicy)(filename);}
 catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT'){return undefined;}throw error;}
}

/** @param {BrowserPolicyRecord} record @param {number|undefined} uid */
function privatePolicy(record,uid){return typeof uid==='number'&&record.uid===uid&&record.regular&&record.mode%PRIVATE_MODE_BASE===START;}

/** @param {string} bytes */
function providerPath(bytes){
 /** @type {unknown} */let policy=null;
 try{policy=JSON.parse(bytes);}catch{throw new Error('Browser admission policy is invalid JSON');}
 if(policy===null||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).toSorted().join(',')!=='module,version'||!('version'in policy)||policy.version!==SCHEMA_VERSION||!('module'in policy)||typeof policy.module!=='string'||!path.isAbsolute(policy.module)){
  throw new Error('Browser admission policy requires version 1 and an absolute provider module');
 }
 return policy.module;
}

const POLICY_MODULE='browser-machine-policy.mjs';
/** The repo-kit lean layout (engine f928fdae2) moved <repo>/scripts/ to
 * <repo>/src/scripts/; a policy written before it names the old folder.
 * @param {string} configured @returns {string|undefined} */
function leanMove(configured){
 const folder=path.dirname(configured),repo=path.dirname(folder);
 return path.basename(folder)==='scripts'&&path.basename(repo)!=='src'?path.join(repo,'src','scripts',path.basename(configured)):undefined;
}
/** QA 11-25 row 103: a provider path that no longer exists either follows the
 * lean move, saying which line to write, or refuses naming the policy file.
 * @param {string} configured @param {BrowserMachineOptions} options */
function providerModule(configured,options){
 const exists=options.exists??existsSync,filename=policyFile(options);
 // Engine worktrees and clean gate copies carry their own implementation.
 // Vite cannot import the canonical checkout's module outside its root.
 // Portable consumers have no sibling provider and retain the machine path.
 const local=path.join(import.meta.dirname,POLICY_MODULE);
 if(path.basename(configured)===POLICY_MODULE&&exists(local)){return local;}
 if(exists(configured)){return configured;}
 const moved=leanMove(configured);
 if(moved!==undefined&&exists(moved)){
  (options.warn??console.warn)(`browser admission: ${filename} names ${configured}, which moved to ${moved}; using it. Write {"version":1,"module":${JSON.stringify(moved)}} to ${filename}.`);
  return moved;
 }
 throw new Error(`Browser admission policy ${filename} names ${configured}, which does not exist${moved===undefined?'':` (nor does the lean layout's ${moved})`}; write the provider's current absolute path there, such as <engine>/src/scripts/${POLICY_MODULE}`);
}

/** @param {unknown} provider @returns {provider is BrowserMachineProvider} */
function validProvider(provider){return provider!==null&&typeof provider==='object'&&'install'in provider&&typeof provider.install==='function';}
/** @param {string} url @returns {Promise<unknown>} */
async function importProvider(url){const provider=await import(url);return provider;}
/** @param {BrowserMachineOptions} options */
async function machineProvider(options){
 const record=await optionalPolicy(options);
 if(record===undefined){return undefined;}
 if(!privatePolicy(record,options.uid??process.getuid?.())){throw new Error('Browser admission policy must be a private owned regular file');}
 const module=providerModule(providerPath(record.bytes),options);
 const provider=await(options.load??importProvider)(pathToFileURL(module).href);
 if(!validProvider(provider)){throw new Error('Browser admission provider has no installer');}
 return provider;
}

/** @param {object} playwright @param {BrowserMachineOptions} [options] */
async function installMachineBrowserAdmission(playwright,options={}){
 const provider=await machineProvider(options);
 if(provider===undefined){return false;}
 await provider.install(playwright);return true;
}
/** @param {BrowserMachineOptions} [options] */
async function reserveMachineBrowserAdmission(options={}){
 const provider=await machineProvider(options);
 if(provider===undefined){return undefined;}
 if(typeof provider.reserve!=='function'){throw new TypeError('Browser admission provider has no worker reservation');}
 return provider.reserve();
}
/** Preserve the exact consumer-resolved Playwright instance while admitting it.
 * @template {object} Namespace @param {Namespace} playwright @returns {Promise<Namespace>} */
async function admittedPlaywright(playwright){
 await installMachineBrowserAdmission(playwright);
 const {installBrowserActorMarker}=await import('./browser-actor-marker.mjs');
 installBrowserActorMarker(playwright);
 return playwright;
}

export{installMachineBrowserAdmission,reserveMachineBrowserAdmission,admittedPlaywright};
