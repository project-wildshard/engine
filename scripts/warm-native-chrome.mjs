#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {open, readdir, realpath} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

/** The native control and its untimed disk preparation must select the same
 * installed browser. Explicit selection wins, with no fallback after failure.
 * @returns {string} */
export function nativeChromeExecutable() {
  const candidates=[process.env.CHROME_PATH,process.env.CHROME_BIN,
    ...(process.platform==='linux'?['/usr/bin/google-chrome','/usr/bin/chromium']:[]),chromium.executablePath()];
  const executable=candidates.find(file=>file!==undefined&&existsSync(file));
  if(executable===undefined)throw new Error('No installed Chromium for the original trusted-input control');
  return executable;
}

/** @param {string} file @returns {Promise<boolean>} */
async function nativeBinary(file) {
  const handle=await open(file,'r');
  try {
    const header=Buffer.alloc(4),{bytesRead}=await handle.read(header,0,4,0);
    if(bytesRead!==4)return false;
    if(header.equals(Buffer.from([0x7f,0x45,0x4c,0x46])))return true;
    if(header.subarray(0,2).toString()==='MZ')return true;
    return [0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(header.readUInt32BE());
  } finally {await handle.close();}
}

/** Read the complete installed executable and startup resources into the OS
 * page cache before any native-control timer starts. This never launches a
 * browser or changes its flags, profile, files or deadlines. One reused MiB
 * buffer bounds process memory; read failures refuse preparation, not retry.
 * @param {string} executable
 * @returns {Promise<{executable:string,binary:string,files:{path:string,bytes:number}[],bytes:number}>} */
export async function warmNativeChrome(executable) {
  const launcher=await realpath(executable);
  let binary=launcher;
  if(!await nativeBinary(binary)) {
    const directory=dirname(launcher);
    const candidates=[join(directory,'chrome'),join(directory,'chromium'),join(directory,'chromium-browser'),
      ...(launcher==='/usr/bin/chromium'?['/usr/lib/chromium/chromium']:[]),
      ...(launcher==='/usr/bin/chromium-browser'?['/usr/lib/chromium-browser/chromium-browser']:[])];
    const installed=[];
    for(const candidate of candidates)if(candidate!==launcher&&existsSync(candidate)&&await nativeBinary(candidate))installed.push(candidate);
    if(installed.length!==1||installed[0]===undefined)throw new Error('Cannot identify the selected Chrome launcher native binary');
    binary=await realpath(installed[0]);
  }
  const paths=new Set([launcher,binary]),directory=dirname(binary);
  const resources=async (/** @type {string} */ root)=>{
    for(const entry of await readdir(root,{withFileTypes:true})){
      const path=join(root,entry.name);
      if(entry.isFile()&&(/\.(?:pak|dat|bin)$/u.test(entry.name)||/\.so(?:\.\d+)*$/u.test(entry.name)
        ||entry.name==='chrome_crashpad_handler'))paths.add(path);
      else if(entry.isDirectory()&&(entry.name==='locales'||entry.name==='swiftshader'))await resources(path);
    }
  };
  await resources(directory);
  const buffer=Buffer.alloc(1024*1024),files=[];
  for(const path of [...paths].sort((left,right)=>left.localeCompare(right))){
    const handle=await open(path,'r');let bytes=0;
    try {
      for(;;){const read=await handle.read(buffer,0,buffer.length,null);if(read.bytesRead===0)break;bytes+=read.bytesRead;}
    } finally {await handle.close();}
    files.push({path,bytes});
  }
  return {executable,binary,files,bytes:files.reduce((sum,file)=>sum+file.bytes,0)};
}

if(process.argv[1]!==undefined&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(process.argv.length!==2)throw new Error('Usage: node scripts/warm-native-chrome.mjs');
  const started=performance.now(),result=await warmNativeChrome(nativeChromeExecutable());
  console.info(JSON.stringify({preparation:'native Chrome files read',milliseconds:performance.now()-started,...result}));
}
