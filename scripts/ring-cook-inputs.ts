import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {formatTemplate} from './pin-format';

interface Pin {readonly slug:string;readonly hash:string}

/** Ring 1 uses the handwritten product in the frozen format dependency,
 * exactly as pins.ts install --ring 1 does. Ring 2 keeps catalogue heads. */
export function ringCookInputs(selected:readonly string[],pins:readonly Pin[],cache:string,ring2=false):{
  readonly heads:readonly Pin[];
  readonly read:(hash:string)=>Uint8Array;
} {
  const format=!ring2&&selected.includes('blender-template')?formatTemplate('blender-template'):undefined;
  const heads=selected.map(slug=>{
    const pin=format?.pin.slug===slug?format.pin:pins.find(row=>row.slug===slug);
    if(pin===undefined)throw new Error(`Not pinned: ${slug}`);
    return pin;
  });
  return {heads,read:hash=>{
    if(!heads.some(head=>head.hash===hash))throw new Error('Cook requested an unselected input');
    return format?.pin.hash===hash?format.bytes:readFileSync(join(cache,`${hash}.tar`));
  }};
}
