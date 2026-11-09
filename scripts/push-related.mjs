import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createVitest} from 'vitest/node';

/** Every changed module needs a real selected test, not merely a nonempty union.
 * Unknown, deleted or failed graph inputs conservatively use the complete gate.
 * @param {{mode:'full'|'related'|'docs',files:string[],reason:string}} selection
 * @param {{cwd?:string}} [options] */
export async function completePushSelection(selection,options={}){
 if(selection.mode!=='related')return selection;
 const root=options.cwd??process.cwd();
 /** @param {string} reason */
 const full=reason=>({...selection,mode:/** @type {const} */('full'),reason});
 for(const file of selection.files){
  if(!existsSync(resolve(root,file)))return full(`Deleted or missing module has no proven graph edge: ${file}`);
  try{
   const context=await createVitest({root,related:[resolve(root,file)],run:true,watch:false},{logLevel:'silent'});
   try{
    const specifications=await context.getRelevantTestSpecifications();
    if(specifications.length===0)return full(`Zero tests selected for ${file}; complete full-suite fallback`);
   }finally{await context.close();}
  }catch{return full(`Cannot prove import-graph coverage for ${file}; complete full-suite fallback`);}
 }
 return {...selection,reason:'Every changed module has actual selected tests; complete related set (J193)'};
}
