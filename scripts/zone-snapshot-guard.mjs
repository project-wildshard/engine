#!/usr/bin/env node
// Zone-snapshot guard (meta ZONE-SNAPSHOTS ZS1, J507, J505's permanent half). Tests read what players load: the live
// pins in test/pins/ by slug, and made-up minimal fixtures. No checked-in copy of a zone may come back:
//   (a) pin-record   a shard-file pin record (`slug` + a 64-hex `hash`/`sha256`) or a `pins/<hash>.tar` path
//                    outside test/pins/ (the live pin files, moved by pin lanes);
//   (b) shard-folder a checked-in `shard.json` whose format is older than the current one, or that names a zone slug;
//   (c) revision-path a test, src or script path naming a zone revision (`<zone>-r<N>`);
//   (d) frozen-path  a frozen zone extract or lift original (`test/fixtures/frozen/`, `legacy-oracles/`, `*-original*`, `kept-*`).
// The baseline (scripts/zone-snapshot-guard.baseline.json) lists today's offenders. It may only shrink: a new offender
// fails, and so does a listed one that no longer offends (`--prune` drops those). ZS10 takes it to zero.
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const ROOT=join(import.meta.dirname,'..');
const BASELINE='scripts/zone-snapshot-guard.baseline.json';
const SCOPE=['test/','src/','scripts/'];
const LIVE='test/pins/';
const SELF=new Set(['scripts/zone-snapshot-guard.mjs','scripts/zone-snapshot-guard.d.mts',BASELINE,'test/zone-snapshot-guard.test.ts']);
const TEXT=/\.(?:json|ts|mts|mjs|js|cjs|tsx)$/u;
/** Zones that left the grid but whose names still mark a snapshot. */
const RETIRED=['ink-cel-valley','pastel-plain'];
/** Short names the tree uses for zones beside their slugs. */
const ALIASES=['dunes','nine','nine-dragon','pine','nalati','sunscar','brasscap','driftwood','mossgate','glowfen'];
const PIN_RECORD=/["']?slug["']?\s*:\s*["'][a-z0-9-]+["'][^{}]{0,400}?["']?(?:hash|sha256)["']?\s*:\s*["'][0-9a-f]{64}["']|["']?(?:hash|sha256)["']?\s*:\s*["'][0-9a-f]{64}["'][^{}]{0,400}?["']?slug["']?\s*:\s*["'][a-z0-9-]+["']/u;
const FROZEN=/^test\/fixtures\/(?:frozen|legacy-oracles)\/|^test\/fixtures\/(?:.*\/)?[^/]*-originals?(?:[-.][^/]*)?$|^test\/fixtures\/kept-[^/]*$/u;
const PIN_TAR=/pins\/[0-9a-f]{64}\.tar/u;

/** @param {string} a @param {string} b */
export function compareVersions(a,b){
  const pa=a.split('.').map(Number),pb=b.split('.').map(Number);
  for(let i=0;i<4;i++){const d=(pa[i]??0)-(pb[i]??0);if(d!==0)return d;}
  return 0;
}

/** The zone names a revision path may not carry: the live pins' slugs, the retired ones and the short names.
 * @param {string[]} slugs */
export function zoneNames(slugs){return [...new Set([...slugs,...RETIRED,...ALIASES])].sort((a,b)=>b.length-a.length);}

/** @param {unknown} json */
function shardVersion(json){
  if(json===null||typeof json!=='object')return undefined;
  const record=/** @type {Record<string, unknown>} */(json);
  if(typeof record.formatVersion==='string')return record.formatVersion;
  if(typeof record.version==='string')return record.version;
  return undefined;
}

/** @param {unknown} json */
function shardSlug(json){
  if(json===null||typeof json!=='object')return undefined;
  const identity=/** @type {Record<string, unknown>} */(json).identity;
  if(identity!==null&&typeof identity==='object'&&typeof (/** @type {Record<string, unknown>} */(identity)).slug==='string')return /** @type {string} */((/** @type {Record<string, unknown>} */(identity)).slug);
  return undefined;
}

/** Every offender in a tree, sorted: `<rule> <path>`.
 * @param {{ paths: string[], read: (path: string) => string, current: string, zones: string[] }} input */
export function zoneSnapshotOffenders({paths,read,current,zones}){
  const names=zoneNames(zones),slugs=new Set([...zones,...RETIRED]);
  const revision=new RegExp(`(?:^|[/_.-])(?:${names.join('|')})-r[0-9]+(?:[/_.-]|$)`,'u');
  /** @type {Set<string>} */
  const found=new Set();
  for(const path of paths){
    if(!SCOPE.some(prefix=>path.startsWith(prefix))||path.startsWith(LIVE)||SELF.has(path))continue;
    if(revision.test(path))found.add(`revision-path ${path}`);
    if(FROZEN.test(path))found.add(`frozen-path ${path}`);
    if(!TEXT.test(path))continue;
    let text;
    try{text=read(path);}catch{continue;}
    if(PIN_RECORD.test(text)||PIN_TAR.test(text))found.add(`pin-record ${path}`);
    if(path.endsWith('/shard.json')||path==='shard.json'){
      /** @type {unknown} */
      let json;
      try{json=JSON.parse(text);}catch{continue;}
      const version=shardVersion(json),slug=shardSlug(json);
      if(version!==undefined&&/^[0-9.]+$/u.test(version)&&compareVersions(version,current)<0)found.add(`shard-folder ${path}`);
      else if(slug!==undefined&&slugs.has(slug))found.add(`shard-folder ${path}`);
    }
  }
  return [...found].sort();
}

/** The current format version, read from the installed format package's source. */
function currentFormat(){
  const text=readFileSync(join(ROOT,'node_modules/@wildshard/format/src/format/version.ts'),'utf8');
  const match=/const SHARDFILE_VERSION = '([0-9.]+)'/u.exec(text);
  if(match===null)throw new Error('zone-snapshot-guard: no SHARDFILE_VERSION in @wildshard/format');
  return match[1];
}

/** The live pins' slugs. */
function liveSlugs(){
  /** @type {Set<string>} */
  const slugs=new Set();
  for(const file of ['test/pins/shardfiles.json','test/pins/staging.json']){
    const path=join(ROOT,file);
    if(!existsSync(path))continue;
    const json=JSON.parse(readFileSync(path,'utf8'));
    for(const shard of json.shards??[])if(typeof shard.slug==='string')slugs.add(shard.slug);
  }
  return [...slugs];
}

/** Compare offenders with the baseline. @param {string[]} offenders @param {string[]} baseline */
export function judge(offenders,baseline){
  const listed=new Set(baseline),now=new Set(offenders);
  return {added:offenders.filter(line=>!listed.has(line)),gone:baseline.filter(line=>!now.has(line))};
}

if(process.argv[1]!==undefined&&import.meta.filename===process.argv[1]){
  const paths=execFileSync('git',['ls-files','-z','--','test','src','scripts'],{cwd:ROOT,encoding:'utf8',maxBuffer:64<<20}).split('\0').filter(Boolean);
  const offenders=zoneSnapshotOffenders({paths,read:path=>readFileSync(join(ROOT,path),'utf8'),current:currentFormat(),zones:liveSlugs()});
  const baselinePath=join(ROOT,BASELINE);
  /** @type {string[]} */
  const baseline=existsSync(baselinePath)?JSON.parse(readFileSync(baselinePath,'utf8')).offenders:[];
  const {added,gone}=judge(offenders,baseline);
  if(process.argv.includes('--prune')&&gone.length>0){
    writeFileSync(baselinePath,`${JSON.stringify({about:'ZONE-SNAPSHOTS ZS1: today\'s zone snapshots; shrink only (node scripts/zone-snapshot-guard.mjs --prune)',offenders:baseline.filter(line=>!gone.includes(line))},null,1)}\n`);
    console.log(`zone-snapshot-guard: baseline pruned by ${gone.length}`);
  }else if(gone.length>0){
    console.error(`zone-snapshot-guard: ${gone.length} baseline entr${gone.length===1?'y':'ies'} no longer offend; run node scripts/zone-snapshot-guard.mjs --prune and commit the baseline:\n${gone.map(line=>`  ${line}`).join('\n')}`);
    process.exitCode=1;
  }
  if(added.length>0){
    console.error(`zone-snapshot-guard (J507): no checked-in zone snapshots. Read the live pin by slug (readBuiltShardfile) or write a made-up minimal fixture:\n${added.map(line=>`  ${line}`).join('\n')}`);
    process.exitCode=1;
  }
  if(process.exitCode!==1)console.log(`zone-snapshot-guard: ${offenders.length} baselined, none new`);
}
