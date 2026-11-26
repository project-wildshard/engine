import {readFileSync} from 'node:fs';
import {join} from 'node:path';

interface Pin {readonly slug:string;readonly hash:string}

/** Both rings cook the catalogue heads from the pin cache (J434 retired Ring 1's
 * handwritten format product). */
export function ringCookInputs(selected:readonly string[],pins:readonly Pin[],cache:string):{
  readonly heads:readonly Pin[];
  readonly read:(hash:string)=>Uint8Array;
} {
  const heads=selected.map(slug=>{
    const pin=pins.find(row=>row.slug===slug);
    if(pin===undefined)throw new Error(`Not pinned: ${slug}`);
    return pin;
  });
  return {heads,read:hash=>{
    if(!heads.some(head=>head.hash===hash))throw new Error('Cook requested an unselected input');
    return readFileSync(join(cache,`${hash}.tar`));
  }};
}
