import { memoryBlocks, memoryOwnerInventory } from './memory-report-blocks.mjs';
import { memoryNoOwner } from './memory-report-data.mjs';

const WIDTH=1179, HEIGHT=2556;
const ACCENTS={'driftwood-isle':'#fbbb2d','pine-hollow':'#89c06a','nalati-grasslands':'#fe8169','sunscar-dunes':'#e989e1','far-reach':'#f9add0','nine-dragon-stack':'#bc8bfe','_template':'#beaf91'};
/** @param {string} value */
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
/** @param {number|null} value */
const mb=value=>value===null?'unavailable':(value/1e6).toFixed(1);
/** Domain palette follows SF64; shard colours are the HUD accents (game/client/shardfile/accent.ts). @param {string} owner */
export function memoryOwnerColour(owner) {
  const name=owner.toLowerCase();
  if(/unattributed|unlabelled|unknown/u.test(name))return 'url(#unknown)';
  if(/audio|music|sound/u.test(name))return '#f5b84b';
  if(/wasm|rapier/u.test(name))return '#b48aff';
  if(/platform|grid|road/u.test(name))return '#4a9cf7';
  if(name.includes('pine hollow'))return ACCENTS['pine-hollow'];
  if(name.includes('nalati'))return ACCENTS['nalati-grasslands'];
  if(name.includes('driftwood'))return ACCENTS['driftwood-isle'];
  for(const [shard,colour]of Object.entries(ACCENTS))if(name.includes(shard))return colour;
  return '#8892a6';
}
/** @param {string} value @param {number} max */
const short=(value,max)=>value.length>max?`${value.slice(0,max-1)}…`:value;
/** @param {string} value @param {number} limit */
function wrap(value,limit){const lines=[];let line='';for(const word of value.split(/\s+/u)){if(line.length+word.length+1>limit){if(line)lines.push(line);line=word;}else line=line?`${line} ${word}`:word;}if(line)lines.push(line);return lines;}
/**
 * Observed storage columns are separate from the physical WC+GL gauge. The cap line applies ONLY to that gauge.
 * @param {import('./memory-report-data.mjs').MemoryReport} report
 * @param {import('./memory-report-data.mjs').MemoryPose} pose
 */
export function memoryInfographic(report,pose){
  const owners=memoryOwnerInventory(pose.accounted.allocations), bricks=memoryBlocks(owners);
  const measured=pose.measured, total=measured?.total;
  const noOwner=memoryNoOwner(pose), shareText=noOwner===null?'owner share unavailable':`${(noOwner.share*100).toFixed(0)}% has no owner (target <10%)`;
  const takeaway=total===undefined?'No valid native measurement; do not infer a fit.':total>report.cap.bytes?`Over cap by ${mb(total-report.cap.bytes)} MB; ${shareText}.`:`${mb(report.cap.bytes-total)} MB under the cap; ${shareText}.`;
  const svg=[`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><defs><pattern id="unknown" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#656b76"/><path d="M-4 4L4-4M0 14L14 0M10 18L18 10" stroke="#b5bac5" stroke-width="3"/></pattern><pattern id="estimated" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M-4 4L4-4M0 16L16 0M12 20L20 12" stroke="#ffffff" stroke-opacity="0.24" stroke-width="2"/></pattern></defs><rect width="1179" height="2556" fill="#111722"/><g font-family="Arial, sans-serif" fill="#f0f3fa">`];
  /** @param {number} x @param {number} y @param {string} value @param {number} size @param {string} colour */
  const text=(x,y,value,size=32,colour='#f0f3fa')=>svg.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${colour}">${escape(value)}</text>`);
  text(64,72,'MEMORY DEBUGGER · GPU / RAM',30,'#aab7cc');text(64,132,short(pose.name.toUpperCase(),40),44);
  const pin=typeof pose.evidence?.pin==='string'?pose.evidence.pin:report.pin;
  text(64,177,`${short(pin,16)} · ${short(report.device,42)}`,27,'#aab7cc');
  text(64,253,total===undefined?'MEASUREMENT MISSING':`${mb(total)} / 1000 MB`,62,total!==undefined&&total>report.cap.bytes?'#ff969c':'#eff6ff');
  text(64,298,short(takeaway,87),25);
  if(measured){
    const max=Math.max(report.cap.bytes*1.15,measured.total), unit=1051/max, y=330;
    svg.push(`<rect x="64" y="${y}" width="1051" height="36" rx="4" fill="#293344"/>`);
    // WC then GL; each split into owned (solid) and no owner (hatched) when the owner ledger exists
    const parts=noOwner===null?[[measured.wc,'#8892a6'],[measured.gl,'#4a9cf7']]:[[noOwner.ramOwned,'#f5b84b'],[noOwner.ram,'url(#unknown)'],[noOwner.gpuOwned,'#4a9cf7'],[noOwner.gpu,'url(#unknown)']];
    let left=64;for(const [bytes,fill]of parts){const width=Number(bytes)*unit;svg.push(`<rect x="${left}" y="${y}" width="${width}" height="36" fill="${fill}"/>`);left+=width;}
    svg.push(`<path d="M${64+report.cap.bytes*unit} 320v62" stroke="#ff5a68" stroke-width="5"/>`);
    text(64,411,noOwner===null?`Native WC ${mb(measured.wc)} + live GL ${mb(measured.gl)} MB`:`WC ${mb(measured.wc)} (owned ${mb(noOwner.ramOwned)}) + GL ${mb(measured.gl)} (owned ${mb(noOwner.gpuOwned)}) MB`,27);
    text(64,452,noOwner===null?`RED LINE = 1000 MB · PID ${measured.pid} · ${measured.time}`:`RED LINE = 1000 MB · HATCHED = NO OWNER ${mb(noOwner.bytes)} MB (RAM ${mb(noOwner.ram)} · GPU ${mb(noOwner.gpu)})`,23,'#c0cbdd');
  }else {text(64,386,'RED CAP LINE: 1000 MB (measurement unavailable)',27,'#ff969c');}
  text(64,512,`Allocator accounted: ${pose.accounted.total===null?'not captured':`${mb(pose.accounted.total)} MB`}`,29,'#c0cbdd');
  text(64,556,'STORAGE INVENTORY · not additional process memory',25,'#c0cbdd');
  text(96,618,`GPU · ${pose.accounted.storageTotals.gpu===null?'unavailable':`${mb(pose.accounted.storageTotals.gpu)} MB`}`,34);
  text(652,618,`RAM · ${pose.accounted.storageTotals.ram===null?'unavailable':`${mb(pose.accounted.storageTotals.ram)} MB`}`,34);
  const maxStorage=Math.max(1e9,pose.accounted.storageTotals.ram??0,pose.accounted.storageTotals.gpu??0), heightPerByte=850/maxStorage;
  for(const domain of ['gpu','ram']){
    const x=domain==='gpu'?96:652;
    svg.push(`<rect x="${x}" y="654" width="430" height="850" fill="#1d2635" stroke="#48536a"/>`);
    let bottom=1504;
    for(const block of bricks.filter(row=>row.domain===domain)){
      const height=block.bytes*heightPerByte;bottom-=height;
      svg.push(`<rect x="${x}" y="${bottom}" width="430" height="${height}" fill="${memoryOwnerColour(block.owner)}" stroke="#111722" stroke-width="1"><title>${escape(block.owner)}: ${block.bytes} bytes</title></rect>`);
      if(owners.some(row=>row.owner===block.owner&&row.domain===domain&&row.estimatedBytes>0))svg.push(`<rect x="${x}" y="${bottom}" width="430" height="${height}" fill="url(#estimated)"/>`);
      if(height>=30)text(x+14,bottom+height/2+8,`${mb(block.bytes)} MB · ${short(block.owner,22)}`,23,'#0b1321');
    }
    if(!owners.some(row=>row.domain===domain&&row.bytes>0))text(x+25,1070,`No ${domain.toUpperCase()} owner ledger`,27,'#b9c4d6');
  }
  text(64,1551,'Each brick ≤50 MB. Diagonal overlay = estimated storage.',25,'#c0cbdd');
  text(64,1591,pose.accounted.storageTotals.ram===null&&pose.accounted.storageTotals.gpu===null?'Storage measurements unavailable; no zero inferred.':`${mb(owners.reduce((sum,row)=>sum+row.estimatedBytes,0))} MB estimated storage. RAM capacity ≠ resident WC.`,25,'#c0cbdd');
  const residentRemainder=pose.evidence?.historicalResidentRemainderBytes;
  if(typeof residentRemainder==='number')text(64,1628,`Historical resident RAM unassigned: ${mb(residentRemainder)} MB (estimate)`,25,'#ffcc7a');
  /** @type {Map<string,{owner:string,gpu:number,ram:number}>} */
  const combined=new Map();for(const row of owners){const item=combined.get(row.owner)??{owner:row.owner,gpu:0,ram:0};item[row.domain]+=row.bytes;combined.set(row.owner,item);}
  const legend=[...combined.values()].sort((a,b)=>(b.gpu+b.ram)-(a.gpu+a.ram));
  text(64,1662,`OWNERS · ${legend.length} total · largest first`,29);text(842,1662,'GPU',26);text(1010,1662,'RAM',26);
  for(const [index,row]of legend.slice(0,10).entries()){
    const y=1712+index*43;svg.push(`<rect x="64" y="${y-23}" width="23" height="23" fill="${memoryOwnerColour(row.owner)}"/>`);
    text(103,y,short(row.owner,42),26);text(842,y,mb(row.gpu),26);text(1010,y,mb(row.ram),26);
  }
  if(legend.length>10)text(64,2166,`${legend.length-10} more owners are itemized in JSON.`,23,'#c0cbdd');
  const notes=pose.missing.length>0?pose.missing.join(' · '):'No missing source fields. Storage attribution is distinct from physical process memory.';
  const lines=wrap(notes,85).slice(0,6);text(64,2228,pose.missing.length>0?'LIMITS / MISSING EVIDENCE':'PROVENANCE / LIMITS',27,'#ffcc7a');
  for(const [index,line]of lines.entries())text(64,2267+index*32,line,23,'#c0cbdd');
  text(64,2506,short(measured?.source??'No native source',85),21,'#aab7cc');
  svg.push('</g></svg>');return svg.join('');
}
