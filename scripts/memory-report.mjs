#!/usr/bin/env node
// SF64/E456: offline native-audit import -> memory-report/1 JSON + portrait owner infographics.
// No game/browser/Simulator is launched; capture remains in the native audit harness and machine lanes.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { memoryNoOwner, nativeMemoryPose, emptyMemoryAttribution, readMemoryAttribution, readMemoryMeasured, readMemoryReport, worstMemoryCrossing, withItemizedMemoryPose } from './memory-report-data.mjs';
import { memoryInfographic } from './memory-report-graphic.mjs';

/** @param {string} path @returns {unknown} */
export function readMemoryJson(path){
  if(statSync(path).size>128_000_000)throw new RangeError('Memory report source exceeds 128 MB');
  const compressed=readFileSync(path), options={maxOutputLength:128_000_000};
  const bytes=path.endsWith('.gz')?gunzipSync(compressed,options):path.endsWith('.br')?brotliDecompressSync(compressed,options):compressed;
  return /** @type {unknown} */(JSON.parse(bytes.toString('utf8')));
}
/** @param {unknown} value @returns {Record<string,unknown>} */
const record=value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Expected memory input object');return /** @type {Record<string,unknown>} */(value);};
/** @param {unknown} value */
const string=value=>{if(typeof value!=='string'||!value)throw new TypeError('Expected memory input string');return value;};
/** @param {unknown} value @returns {unknown[]} */
const array=value=>{if(!Array.isArray(value))throw new TypeError('Expected memory input array');return value;};

/** Import explicit native poses and matched crossing windows. Missing centres always get their own page.
 * @param {unknown} value
 * @param {string} directory Relative paths are resolved next to the manifest.
 * @returns {import('./memory-report-data.mjs').MemoryReport}
 */
export function memoryReportFromManifest(value,directory){
  const input=record(value);if(input.schema==='memory-report/1')return readMemoryReport(input);
  if(input.schema!=='memory-report-input/1')throw new Error('Unsupported memory report input');
  const centres=array(input.centres).map(string), inputs=array(input.poses).map(record);
  if(new Set(centres).size!==centres.length)throw new Error('Duplicate expected shard centre');
  const required=['road',...centres.map(name=>`${name}-centre`)];
  if(inputs.some(row=>!required.includes(string(row.name))))throw new Error('Input pose is not a requested road/centre');
  if(new Set(inputs.map(row=>row.name)).size!==inputs.length)throw new Error('Duplicate input pose');
  const cache=new Map();
  /** @param {string} path */
  const load=path=>{const file=resolve(directory,path);if(!cache.has(file))cache.set(file,readMemoryJson(file));return cache.get(file);};
  const poses=required.map(name=>{
    const row=inputs.find(pose=>pose.name===name);
    if(!row)return {name,measured:null,accounted:emptyMemoryAttribution(),missing:['No native source supplied for this required pose']};
    if(row.unavailable!==undefined){
      if(row.native!==undefined||row.attribution!==undefined||row.itemized!==undefined)throw new Error('Unavailable pose cannot hide supplied evidence');
      return {name,measured:null,accounted:emptyMemoryAttribution(),missing:[string(row.unavailable)]};
    }
    const native=record(row.native), file=string(native.file), label=string(native.label);
    const attribution=row.attribution===undefined?null:load(string(row.attribution));
    const pose=nativeMemoryPose(load(file),label,name,`${file}#${label}`,attribution);
    pose.evidence={...pose.evidence,pin:string(row.pin??input.pin)};
    if(row.itemized===undefined)return pose;
    const historical=record(row.itemized), path=string(historical.file);
    return withItemizedMemoryPose(pose,load(path),string(historical.id),path);
  });
  const crossing=input.crossing===undefined?null:record(input.crossing);
  const samples=crossing===null?[]:array(crossing.samples).map(entry=>{
    const row=record(entry), measured=readMemoryMeasured(row.measured);
    if(measured===null)throw new Error('Crossing sample has no native measurement');
    return {measured,glTime:string(row.glTime),accounted:row.attribution===undefined?emptyMemoryAttribution():readMemoryAttribution(load(string(row.attribution)))};
  });
  poses.push(worstMemoryCrossing(samples,crossing?.complete===true));
  return readMemoryReport({schema:'memory-report/1',pin:string(input.pin),device:string(input.device),settings:record(input.settings),cap:{bytes:1e9},poses});
}

/** @param {string[]} args */
async function main(args){
  if(args.includes('--help')){console.log('node scripts/memory-report.mjs --input=<native-manifest-or-memory-report.json> --out=<new-directory> [--svg-only]\nWrites memory-report/1 JSON, 1179x2556 SVG and JPEG per road/centre/worst-crossing. Bytes in JSON; decimal MB on images. Offline import only; no game launch. Exit2 = explicit missing evidence.');return;}
  const input=args.find(arg=>arg.startsWith('--input='))?.slice(8), output=args.find(arg=>arg.startsWith('--out='))?.slice(6);
  if(!input||!output||args.some(arg=>!arg.startsWith('--input=')&&!arg.startsWith('--out=')&&arg!=='--svg-only'))throw new Error('Pass --input and --out (new directory); use --help');
  const report=memoryReportFromManifest(readMemoryJson(input),dirname(resolve(input))), out=resolve(output);
  const svgOnly=args.includes('--svg-only');
  // Engine's declared sharp (devDependency, optional peer for installs) renders static SVG; no browser/GPU context.
  const sharp=svgOnly?null:createRequire(import.meta.url)('sharp');
  mkdirSync(out); // Refuse an existing directory, so no prior evidence can be overwritten.
  // `noOwner` is derived (SF64's < 10 % target); a re-import recomputes it, it is never read back as evidence
  writeFileSync(join(out,'report.json'),`${JSON.stringify({...report,poses:report.poses.map(pose=>({...pose,noOwner:memoryNoOwner(pose)}))},null,2)}\n`);
  const files=[];
  for(const [index,pose]of report.poses.entries()){
    const stem=`${String(index+1).padStart(2,'0')}-${pose.name.replaceAll(/[^a-zA-Z0-9_-]/gu,'-').slice(0,100)}`;
    const svg=memoryInfographic(report,pose), svgFile=join(out,`${stem}.svg`);writeFileSync(svgFile,svg);
    const jpegFile=join(out,`${stem}.jpg`);
    if(sharp!==null){await sharp(Buffer.from(svg)).jpeg({quality:86,mozjpeg:true}).toFile(jpegFile);if(statSync(jpegFile).size>500_000)throw new Error('Portrait infographic exceeds committed-image limit');}
    files.push({pose:pose.name,svg:basename(svgFile),jpeg:svgOnly?null:basename(jpegFile)});
  }
  writeFileSync(join(out,'files.json'),`${JSON.stringify(files,null,2)}\n`);
  const incomplete=report.poses.filter(pose=>pose.measured===null||pose.missing.length>0);
  console.log(`Wrote ${report.poses.length} portrait pages + report.json; ${incomplete.length} poses have explicit missing evidence`);
  if(incomplete.length>0)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{await main(process.argv.slice(2));}catch(error){console.error(error);process.exitCode=1;}
}
