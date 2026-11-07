/** Borrow at most four named input reads at once. Keep publication and refusal
 * in source order, preserve the caller's ownership checks, and drain every
 * started read before returning. This owns no settled cache or byte copies. */
export async function readFileInputs(names: readonly string[], read: (name: string) => Promise<Uint8Array>, live: () => void): Promise<Map<string, Uint8Array>> {
  const pending=new Map<number,Promise<Uint8Array>>(),files=new Map<string,Uint8Array>();let failed=false;
  try{
    for(let index=0;index<names.length;index++){
      for(let at=index;at<Math.min(names.length,index+4);at++){
        if(failed)break;
        if(pending.has(at))continue;
        const name=names[at];if(name===undefined)throw new Error('Missing named input');
        live();const work=(async()=>{try{const bytes=await read(name);live();return bytes;}catch(error){failed=true;throw error;}})();
        void work.catch(()=>undefined);pending.set(at,work);
      }
      const name=names[index],work=pending.get(index);
      if(name===undefined||work===undefined)throw new Error('Missing named input read');
      const bytes=await work;live();files.set(name,bytes);pending.delete(index);
    }
    live();return files;
  }finally{await Promise.allSettled(pending.values());}
}
