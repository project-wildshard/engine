// G570: label reviewed view spans without changing custom ownership or credit.
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseSync} from 'vite';
import * as v from 'valibot';

const path=v.pipe(v.string(),v.regex(/^src\/(?:shards|engine|game|sdk|sharddev)\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+\.(?:ts|tsx|glsl)$/u));
const label=v.pipe(v.string(),v.minLength(1));
const entry=v.strictObject({path,name:v.exactOptional(v.pipe(label,v.regex(/^[A-Za-z_$][\w$]*$/u))),reason:label,decision:v.pipe(v.string(),v.regex(/^G\d+$/u))});
const register=v.strictObject({schema:v.literal(1),shards:v.record(label,v.array(entry))});

/** The HOST-BAR register is explicit; an isolated ruler fixture may have none.
 * @param {string} root @returns {import('./listed-view-code.mjs').ListedViewRegister} */
export function loadListedViews(root){
  const file=resolve(root,'lint/listed-view-code.json');
  const rows=v.parse(register,existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{schema:1,shards:{}});
  for(const [slug,entries] of Object.entries(rows.shards)){
    const seen=new Map();
    for(const row of entries){
      if(row.path.startsWith('src/shards/')&&!row.path.startsWith(`src/shards/${slug}/`))throw new Error(`Listed view belongs to another shard: ${row.path}`);
      const names=seen.get(row.path)??new Set();
      if(names.has(row.name)||names.has(undefined)||row.name===undefined&&names.size>0)throw new Error(`Overlapping listed view registration: ${slug}/${row.path}`);
      names.add(row.name);seen.set(row.path,names);
    }
  }
  return rows;
}

/** Select named top-level physical lines, retaining the ruler's comment unit.
 * @param {string} text @param {string} file @param {readonly string[]} names
 * @returns {Set<number>} */
function selectedLines(text,file,names){
  const parsed=parseSync(file,text),chunks=[];let at=0;
  for(const comment of parsed.comments){chunks.push(text.slice(at,comment.start),text.slice(comment.start,comment.end).replaceAll(/[^\n]/gu,' '));at=comment.end;}
  chunks.push(text.slice(at));const lines=chunks.join('').split('\n');
  const selected=new Set();
  for(const statement of parsed.program.body){
    const node='declaration' in statement?statement.declaration:statement;
    if(node===null)continue;
    const declared=node.type==='VariableDeclaration'?node.declarations.flatMap(row=>row.id.type==='Identifier'?[row.id.name]:[])
      :'id' in node&&node.id?.type==='Identifier'?[node.id.name]:[];
    if(!declared.some(name=>names.includes(name)))continue;
    const first=text.slice(0,statement.start).split('\n').length-1,last=text.slice(0,statement.end).split('\n').length-1;
    for(let line=first;line<=last;line++)if(lines[line]?.trim())selected.add(line);
  }
  return selected;
}

/** An additive partition of already-counted custom contributions. A tag never
 * supplies users, removes a charge, changes a ratio or closes a component.
 * @param {string} root @param {string} slug
 * @param {readonly import('./shard-platform.mjs').CustomSource[]} sources
 * @param {number} total
 * @param {import('./listed-view-code.mjs').ListedViewRegister} rows
 * @returns {import('./listed-view-code.mjs').ListedViewInventory} */
export function listedViewInventory(root,slug,sources,total,rows=loadListedViews(root)){
  const entries=rows.shards[slug]??[],matched=new Set();let listedViewLines=0;
  /** @type {Map<import('./listed-view-code.mjs').ListedViewEntry,number>} */
  const counts=new Map();
  for(const source of sources){
    const owner=source.ownerPath??source.path,matching=entries.filter(row=>row.path===owner);
    if(matching.length===0)continue;
    let lines=0;
    const whole=matching.find(row=>row.name===undefined),named=matching.find(row=>row.name===source.name);
    const direct=whole??(source.kind==='sole-export'?named:undefined);
    if(direct!==undefined){
      lines=source.lines;counts.set(direct,(counts.get(direct)??0)+lines);if(lines>0)matched.add(direct);
    }else if(source.kind!=='sole-export'&&source.kind!=='additional-glsl'){
      const file=resolve(root,source.path);
      if(existsSync(file)){
        const text=readFileSync(file,'utf8'),assigned=new Set();
        for(const row of matching){
          if(row.name===undefined)continue;
          const selected=[...selectedLines(text,source.path,[row.name])].filter(line=>!source.excludedLines?.includes(line+1));let owned=0;
          if(selected.length>0)matched.add(row);
          for(const line of selected)if(!assigned.has(line)){assigned.add(line);owned++;}
          counts.set(row,(counts.get(row)??0)+owned);
        }
        lines=assigned.size;
      }
    }
    if(lines>source.lines)throw new Error(`Listed view exceeds charged span: ${slug}/${owner}`);
    listedViewLines+=lines;
  }
  if(listedViewLines>total)throw new Error(`Listed view exceeds custom total: ${slug}`);
  return {totalCustomLines:total,listedViewLines,otherCustomLines:total-listedViewLines,
    register:entries.map(row=>{
      /** @type {import('./listed-view-code.mjs').ListedViewEntry&{matched:boolean,lines:number}} */
      const result={path:row.path,reason:row.reason,decision:row.decision,matched:matched.has(row),lines:counts.get(row)??0};
      if(row.name!==undefined)result.name=row.name;
      return result;
    })};
}
