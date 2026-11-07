import type {NativeGroundRecord,NativeCollisionBake} from '@wildshard/engine/game/population/nativeBake';

/** Independent pre-B6 inline decoder, held only by the historical native oracle. */
/** Decode an owned copy of one native base64 buffer; typed views never share
 * caller storage. Malformed data is refused by atob or its typed-array reader. */
export function nativeBakeBytes(text: string): Uint8Array<ArrayBuffer> {
  // String iteration materializes a temporary character list before the byte copy.
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
  return bytes;
}
/** The original column-major native float payload, with no resampling. */
export function nativeBakeFloats(text: string): Float32Array<ArrayBuffer> {
  return new Float32Array(nativeBakeBytes(text).buffer);
}

/** The original inline lattice intake, before modern products required files. */
export function originalNativeGround(row:Omit<NativeGroundRecord,'heights'>&{readonly heights:string},resolution:number,size:number,label:string):NativeCollisionBake['ground'] {
  const heights=nativeBakeFloats(row.heights);
  if(heights.length!==resolution**2||row.scale.x!==size||row.scale.z!==size||row.scale.y!==1)
    throw new Error(`${label} baked floor is not its ${String(resolution)}² lattice`);
  return {heights,friction:row.friction,groups:row.groups,scale:row.scale,at:row.at};
}
