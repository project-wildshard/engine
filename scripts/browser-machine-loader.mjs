// Portable tools discover one owned machine provider. Missing policy is
// portable; an unsafe or broken present policy refuses admission.
import {constants} from 'node:fs';
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
async function optionalPolicy(options){
 const filename=options.path??path.join(homedir(),'.config','wildshard','browser-admission.json');
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

/** @param {unknown} provider @returns {provider is BrowserMachineProvider} */
function validProvider(provider){return provider!==null&&typeof provider==='object'&&'install'in provider&&typeof provider.install==='function';}
/** @param {string} url @returns {Promise<unknown>} */
async function importProvider(url){const provider=await import(url);return provider;}
/** @param {BrowserMachineOptions} options */
async function machineProvider(options){
 const record=await optionalPolicy(options);
 if(record===undefined){return undefined;}
 if(!privatePolicy(record,options.uid??process.getuid?.())){throw new Error('Browser admission policy must be a private owned regular file');}
 const provider=await(options.load??importProvider)(pathToFileURL(providerPath(record.bytes)).href);
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
async function admittedPlaywright(playwright){await installMachineBrowserAdmission(playwright);return playwright;}

export{installMachineBrowserAdmission,reserveMachineBrowserAdmission,admittedPlaywright};
