#!/usr/bin/env node
// SHARD-COMPAT SP4: the fingerprints a push moves, printed in CI. `node src/scripts/fingerprints.ts --base <ref>` compares
// this checkout's HEAD with <ref> and prints one line each: the renderer fingerprint (re-prepare when it moves, SP3), the
// cook revision (recook when it moves, SP7), the shard file format version and the migration chain id of the format pin.
// The base side reads only the files the push changed from git and everything else from the checkout, so it costs one
// `git diff` and a blob per changed file, never a second checkout. In CI it appends to the job summary; it never fails a
// run (a fingerprint it cannot read prints `unknown`).
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import './format-hook.mjs';
import {cookRevision} from './cook-revision.ts';
import {narrowedRendererHash,publishedRenderer} from './renderer-revision.mjs';
import {committedSourceFiles} from './source-input-proof.mjs';

type Read = (path:string)=>Buffer;
interface Side {readonly paths:readonly string[];readonly read:Read}
export interface Fingerprints {readonly renderer:string;readonly cook:string;readonly formatPin:string}
export interface FingerprintLines {readonly lines:readonly string[];readonly moved:readonly string[]}

const ROOT=resolve(import.meta.dirname,'..', '..');
const git=(args:readonly string[]):Buffer=>execFileSync('git',args,{cwd:ROOT,maxBuffer:1<<30});
const short=(value:string):string=>value.slice(0,12);

/** The checkout's HEAD, read from disk. */
function headSide():Side {return {paths:committedSourceFiles(ROOT),read:path=>readFileSync(resolve(ROOT,path))};}

/** `ref`'s side: the files it differs from HEAD in from git, the rest from the checkout (one diff, a blob per change). */
export function sideAt(ref:string):Side {
  const head=headSide();
  if(ref==='HEAD')return head;
  const fields=git(['diff','--name-status','--no-renames','-z',ref,'HEAD']).toString('utf8').split('\0');
  const changed=new Set<string>(),added=new Set<string>(),deleted=new Set<string>();
  for(let index=0;index+1<fields.length;index+=2) {
    const status=fields[index]??'',path=fields[index+1]??'';
    if(path==='')continue;
    changed.add(path);
    if(status==='A')added.add(path);
    if(status==='D')deleted.add(path);
  }
  const paths=[...head.paths.filter(path=>!added.has(path)),...deleted];
  return {paths,read:path=>changed.has(path)?git(['show',`${ref}:${path}`]):head.read(path)};
}

/** The renderer fingerprint, the cook revision over HEAD's cook closure and the format pin, for one side. */
export function fingerprintsOf(side:Side,closure:readonly string[]):Fingerprints {
  const renderer=publishedRenderer(narrowedRendererHash([...side.paths],side.read));
  const pkg=JSON.parse(side.read('package.json').toString('utf8')) as {dependencies?:Record<string,string>};
  const formatPin=pkg.dependencies?.['@wildshard/format']??'none';
  const known=new Set(side.paths),hash=createHash('sha256').update(JSON.stringify({renderer,formatPin}));
  for(const file of closure)hash.update(file).update('\0').update(known.has(file)||file==='pnpm-lock.yaml'?side.read(file):'').update('\0');
  return {renderer,cook:hash.digest('hex'),formatPin};
}

/** The format version and migration chain id of the installed format pin (the chain id as format's runner names it). */
export async function formatOf():Promise<{version:string;chain:string}> {
  const {SHARDFILE_VERSION}=await import('@wildshard/format/version');
  const {FORMAT_MIGRATIONS}=await import('@wildshard/format/formatMigrations');
  const {validationSourceBytes}=await import('@wildshard/format/validationReceipt');
  const steps=FORMAT_MIGRATIONS.map(step=>({id:step.id,to:step.to,touches:step.touches,affects:[...step.affects]}));
  return {version:SHARDFILE_VERSION,chain:createHash('sha256').update(validationSourceBytes({runner:1,migrations:steps})).digest('hex')};
}

/** The lines: each fingerprint `moved` or `same` against the base; format and chain move with the format pin (their
 * values are the installed pin's, so a replay of an older push prints the pin alone). */
export function fingerprintLines(base:string,sides:{head:Fingerprints;base:Fingerprints},format:{version:string;chain:string}|undefined):FingerprintLines {
  const pinMoved=sides.head.formatPin!==sides.base.formatPin;
  const rows:[string,boolean,string][]=[
    ['renderer',sides.head.renderer!==sides.base.renderer,short(sides.head.renderer)],
    ['cook',sides.head.cook!==sides.base.cook,short(sides.head.cook)],
    ['format',pinMoved,`${format===undefined?'':`${format.version} `}(pin ${sides.head.formatPin}${pinMoved?`, was ${sides.base.formatPin}`:''})`],
    ['chain',pinMoved,format===undefined?'(follows the pin)':short(format.chain)],
  ];
  return {
    lines:[`fingerprints against ${short(base)}:`,...rows.map(([name,moved,value])=>`${name}: ${moved?'moved':'same'} ${value}`)],
    moved:rows.filter(([,moved])=>moved).map(([name])=>name),
  };
}

/** `--base <ref>` (default HEAD~1) and `--head <ref>` (default HEAD: a replay of an older push names both). */
function refs(args:readonly string[]):{base:string|undefined;head:string} {
  const value=(flag:string):string|undefined=>{const at=args.indexOf(flag);return at===-1?undefined:args[at+1];};
  return {base:value('--base')??'HEAD~1',head:value('--head')??'HEAD'};
}

async function main():Promise<void> {
  const {base,head}=refs(process.argv.slice(2));
  if(base===undefined||base===''||/^0+$/u.test(base)){console.info('fingerprints: no base to compare (a new branch): skipped');return;}
  let lines:readonly string[];
  try {
    const {files}=cookRevision(ROOT);
    lines=fingerprintLines(base,{head:fingerprintsOf(sideAt(head),files),base:fingerprintsOf(sideAt(base),files)},head==='HEAD'?await formatOf():undefined).lines;
  } catch(error) {lines=[`fingerprints against ${short(base)}: unknown (${error instanceof Error?error.message:String(error)})`];}
  for(const line of lines)console.info(line);
  const {GITHUB_STEP_SUMMARY:summary}=process.env;
  if(summary!==undefined&&summary!==''&&existsSync(resolve(summary,'..')))appendFileSync(summary,`\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
}

if(import.meta.filename===resolve(process.argv[1]??''))await main();
