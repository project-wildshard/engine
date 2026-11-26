/** Hash parsed emitted JavaScript tokens after checking the current raw digest.
 * This is a pure normalization cache, never a filesystem/admission verdict. */
export function compilerCodeHash(file:string,rawHash:string,read:()=>Uint8Array):string;
