import {existsSync} from 'node:fs';
import {relative,resolve} from 'node:path';
import {createVitest} from 'vitest/node';

/** Every changed module needs a real selected test, not merely a nonempty union.
 * Unknown, deleted or failed graph inputs conservatively use the complete gate.
 * @param {{mode:'full'|'related'|'docs',files:string[],reason:string}} selection
 * @param {{cwd?:string}} [options]
 * @returns {Promise<{mode:'full'|'related'|'docs',files:string[],reason:string,tests?:string[]}>} */
export async function completePushSelection(selection,options={}){
 if(selection.mode!=='related')return selection;
 const root=options.cwd??process.cwd();
 /** @param {string} reason */
 const full=reason=>({...selection,mode:/** @type {const} */('full'),reason});
 /** @type {Set<string>} */const tests=new Set();
 for(const file of selection.files){
  if(!existsSync(resolve(root,file)))return full(`Deleted or missing module has no proven graph edge: ${file}`);
  try{
   const context=await createVitest({root,related:[resolve(root,file)],run:true,watch:false},{logLevel:'silent'});
   try{
    const specifications=await context.getRelevantTestSpecifications();
    if(specifications.length===0)return full(`Zero tests selected for ${file}; complete full-suite fallback`);
    for(const specification of specifications)tests.add(relative(root,specification.moduleId).replaceAll('\\','/'));
   }finally{await context.close();}
  }catch{return full(`Cannot prove import-graph coverage for ${file}; complete full-suite fallback`);}
 }
 // DS9: the split gate runs these exact files; the normal gate still asks Vitest by source.
 return {...selection,tests:[...tests].sort(),reason:'Every changed module has actual selected tests; complete related set (J193)'};
}
