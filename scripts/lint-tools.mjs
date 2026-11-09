import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {isAbsolute,resolve} from 'node:path';
import * as v from 'valibot';

const manifestSchema=v.object({binDependencies:v.record(v.string(),v.string())});
const packageSchema=v.object({name:v.literal('oxlint-tsgolint'),version:v.string()});

/** Resolve the frozen native helper through npr's public command, never its cache layout.
 * @param {string} [root] */
export function nativeLintTool(root=resolve(import.meta.dirname,'..')){
  const pin=v.parse(manifestSchema,JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'))).binDependencies['oxlint-tsgolint'];
  if(pin===undefined||!/^\d+\.\d+\.\d+$/u.test(pin))throw new Error('Missing exact native lint pin');
  const found=spawnSync(resolve(root,'node_modules/.bin/npr'),['which','tsgolint'],{cwd:root,encoding:'utf8',timeout:30_000});
  if(found.error!==undefined||found.status!==0||!isAbsolute(found.stdout.trim())||found.stdout.trim().includes('\n'))throw new Error(`Pinned native lint unavailable: ${found.error?.message??found.stderr}`);
  const metadata=createRequire(found.stdout.trim()).resolve('oxlint-tsgolint/package.json');
  const installed=v.parse(packageSchema,JSON.parse(readFileSync(metadata,'utf8')));
  if(installed.version!==pin)throw new Error('Native lint helper differs from its manifest pin');
  const binary=createRequire(metadata).resolve(`@oxlint-tsgolint/${process.platform}-${process.arch}/tsgolint${process.platform==='win32'?'.exe':''}`);
  return {binary,version:installed.version};
}

/** Preserve an explicit Oxlint override; default callers receive the pinned native executable.
 * @param {string} [root] @param {NodeJS.ProcessEnv} [environment] @returns {NodeJS.ProcessEnv} */
export function lintEnvironment(root=resolve(import.meta.dirname,'..'),environment=process.env){
  return environment.OXLINT_TSGOLINT_PATH===undefined?{...environment,OXLINT_TSGOLINT_PATH:nativeLintTool(root).binary}:{...environment};
}
