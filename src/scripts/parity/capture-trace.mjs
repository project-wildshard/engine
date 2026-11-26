import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

/** @typedef {{label:string,stage:string,state:string,ms:number|null,message?:string}} CaptureStage */
/** Read screenshot observations available in a retained Playwright trace.
 * Unknown/missing records stay unavailable; native Chromium RPCs are not exposed by tracing.
 * @param {string} text @param {string} label @returns {CaptureStage[]} */
export function screenshotTraceStages(text, label) {
  /** @type {CaptureStage[]} */ const rows = [];
  /** @type {Map<string,number>} */ const starts = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    /** @type {unknown} */ let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row === null || typeof row !== 'object' || !('type' in row) || !('callId' in row) || typeof row.callId !== 'string') continue;
    if (row.type === 'before' && 'method' in row && row.method === 'screenshot' && 'startTime' in row && typeof row.startTime === 'number' && Number.isFinite(row.startTime)) {
      starts.set(row.callId, row.startTime);
    } else if (row.type === 'log' && starts.has(row.callId) && 'time' in row && typeof row.time === 'number' && Number.isFinite(row.time) && 'message' in row && typeof row.message === 'string') {
      const start = starts.get(row.callId);
      if (start !== undefined) rows.push({label,stage:'screenshot-api-log',state:'observed',ms:row.time-start,message:row.message});
    } else if (row.type === 'after' && 'endTime' in row && typeof row.endTime === 'number' && Number.isFinite(row.endTime)) {
      const start = starts.get(row.callId);
      if (start !== undefined) {
        rows.push({label,stage:'screenshot-api',state:'error' in row ? 'refused' : 'complete',ms:row.endTime-start});
        starts.delete(row.callId);
      }
    }
  }
  for (const _start of starts.values()) rows.push({label,stage:'screenshot-api',state:'unfinished',ms:null});
  if (!rows.some(row=>row.stage==='screenshot-api')) rows.push({label,stage:'screenshot-api',state:'unavailable',ms:null});
  return rows;
}

/** @type {WeakMap<import('playwright').Page,{out:string,receipt:string,index:number}>} */
const paths = new WeakMap();
/** @param {import('playwright').Page} page @param {string} out @param {string} receipt */
export function registerCaptureTrace(page, out, receipt) { paths.set(page,{out,receipt,index:0}); }
/** Stable tracing observes the existing screenshot, with no extra draw or capture.
 * Keep its archive even when observations cannot identify the native stall.
 * @param {import('playwright').Page} page @param {string} label @returns {Promise<()=>Promise<void>>} */
export async function beginCaptureTrace(page, label) {
  const target=paths.get(page);
  if (!target) return ()=>Promise.resolve();
  const path=join(target.out,`${target.receipt}-capture-${++target.index}.zip`);
  const emit=(/** @type {CaptureStage} */ row)=>console.log(`boot-capture-trace ${JSON.stringify(row)}`);
  for (const stage of ['layout-metrics','native-capture','png-encode','native-cleanup']) emit({label,stage,state:'unavailable-in-stable-trace',ms:null});
  const tracing=page.context().tracing;
  try { await tracing.start({screenshots:false,snapshots:false,sources:false}); }
  catch (error) {
    console.log(`boot-capture-trace unavailable: ${String(error)}`);
    return ()=>Promise.resolve();
  }
  return async()=>{
    try {
      await tracing.stop({path});
      console.log(`boot-capture-trace archive ${path}`);
      const files=unzipSync(readFileSync(path),{filter:file=>file.name.endsWith('.trace')});
      const text=Object.values(files).map(bytes=>strFromU8(bytes)).join('\n');
      for (const row of screenshotTraceStages(text,label)) emit(row);
    } catch (error) { console.log(`boot-capture-trace unavailable: ${String(error)}`); }
  };
}
