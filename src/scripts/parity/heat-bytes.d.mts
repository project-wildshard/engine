import type { JSHandle } from 'playwright';
import type { ByteSinkPage } from '../bake-output.mjs';

/** Publish optional native JPEG bytes and always retire the handle/upload route. */
export function readHeatFrame<T extends {heat:Blob|null}>(page:ByteSinkPage,handle:Pick<JSHandle<T>,'evaluate'|'dispose'>,file?:string):Promise<Omit<T,'heat'>>;
