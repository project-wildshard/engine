import {existsSync} from 'node:fs';
import {relative,resolve} from 'node:path';
import {createVitest} from 'vitest/node';

/** Every changed module needs a real selected test, not merely a nonempty union.
 * Unknown, deleted or failed graph inputs conservatively use the complete gate.
 * Meta QA 11-26 row 87: a full fallback still carries every test the other modules selected. engine 0c3e3df8c changed
 * zone-entry.mjs with two tests reading it, but phone-memory-card-proof.mjs (a script no test imports) turned the push
 * full, and the split gate's full mode ran only the native files, so main went red on hosted CI. The split gate now runs
 * the carried tests locally (src/scripts/push-local-split.mjs splitLocalTests); the complete local gate runs everything.
 * @param {{mode:'full'|'related'|'docs',files:string[],reason:string}} selection
 * @param {{cwd?:string,related?:(file:string)=>Promise<string[]>}} [options] `related` lists a module's test files
 *   (root-relative); the default asks Vitest's import graph. It throws when the graph can't be proven.
 * @returns {Promise<{mode:'full'|'related'|'docs',files:string[],reason:string,tests?:string[]}>} */
export async function completePushSelection(selection,options={}){
 if(selection.mode!=='related')return selection;
 const root=options.cwd??process.cwd();
 const related=options.related??(file=>vitestRelated(root,file));
 /** @type {Set<string>} */const tests=new Set();
 /** @type {string|null} */let fallback=null;
 for(const file of selection.files){
  if(!existsSync(resolve(root,file))){fallback??=`Deleted or missing module has no proven graph edge: ${file}`;continue;}
  /** @type {string[]} */let found;
  try{found=await related(file);}catch{fallback??=`Cannot prove import-graph coverage for ${file}; complete full-suite fallback`;continue;}
  if(found.length===0)fallback??=`Zero tests selected for ${file}; complete full-suite fallback`;
  for(const test of found)tests.add(test);
 }
 if(fallback!==null)return {...selection,mode:'full',reason:fallback,tests:[...tests].sort()};
 // DS9: the split gate runs these exact files; the normal gate still asks Vitest by source.
 return {...selection,tests:[...tests].sort(),reason:'Every changed module has actual selected tests; complete related set (J193)'};
}

/** One module's test files from Vitest's import graph. @param {string} root @param {string} file */
async function vitestRelated(root,file){
 const context=await createVitest({root,related:[resolve(root,file)],run:true,watch:false},{logLevel:'silent'});
 try{
  const specifications=await context.getRelevantTestSpecifications();
  return specifications.map(specification=>relative(root,specification.moduleId).replaceAll('\\','/'));
 }finally{await context.close();}
}
