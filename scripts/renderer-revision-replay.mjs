#!/usr/bin/env node
// J259 (SHARD-PIPELINE SP3): replay the narrowed renderer fingerprint over a commit range and count the commits that
// move it. `node scripts/renderer-revision-replay.mjs 86b7e10..c5157283` prints one line per move and a total. It needs
// the range's history (no shallow clone), so it is a by-hand proof, not a CI job.
import {execFileSync} from 'node:child_process';
import {narrowedRendererHash,publishedRenderer,rendererCandidate} from './renderer-revision.mjs';

const [range]=process.argv.slice(2);
if(range===undefined||!range.includes('..'))throw new Error('usage: renderer-revision-replay.mjs <from>..<to>');
const git=(args,options={})=>execFileSync('git',args,{maxBuffer:1<<30,...options});
const commits=git(['rev-list','--reverse','--first-parent',range],{encoding:'utf8'}).split('\n').filter(Boolean);
const [from]=range.split('..');

/** @param {string} commit @returns {Map<string,string>} path -> blob id */
const tree=commit=>new Map(git(['ls-tree','-r','-z',commit],{encoding:'utf8'}).split('\0').filter(Boolean).map(row=>{
  const [meta,path]=row.split('\t');return [path,meta.split(' ')[2]];}));

/** Blob bytes by id, read once through one `git cat-file --batch` per commit's new ids. */
const blobs=new Map();
const load=ids=>{
  const fresh=[...new Set(ids)].filter(id=>!blobs.has(id));
  if(fresh.length===0)return;
  const out=git(['cat-file','--batch'],{input:`${fresh.join('\n')}\n`});
  let at=0;
  for(const id of fresh){
    const end=out.indexOf(10,at),size=Number(out.subarray(at,end).toString('utf8').split(' ')[2]);
    blobs.set(id,out.subarray(end+1,end+1+size));at=end+1+size+1;
  }
};
const fingerprint=commit=>{
  const files=tree(commit),paths=[...files.keys()],wanted=paths.filter(path=>rendererCandidate(path)||path==='package.json');
  load(wanted.map(path=>files.get(path)));
  return publishedRenderer(narrowedRendererHash(paths,path=>blobs.get(files.get(path))));
};

let previous=fingerprint(from),moves=0;
for(const commit of commits){
  const value=fingerprint(commit);
  if(value!==previous){moves+=1;console.log(`moved ${commit.slice(0,8)} ${value.slice(0,8)} ${git(['log','-1','--format=%s',commit],{encoding:'utf8'}).trim()}`);}
  previous=value;
}
console.log(`renderer fingerprint moved in ${moves} of ${commits.length} commits (${range})`);
