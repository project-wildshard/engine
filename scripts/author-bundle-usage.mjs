// Opt-in transport observations; no compiler byte or admission result changes.
import {basename,resolve} from 'node:path';

export const AUTHOR_BUNDLE_USE_PREFIX='author bundle use: ';
/** Emit only actual successful compiler use. Unknown callers remain explicit so
 * a future sweep cannot mistake incomplete coverage for unused cache content.
 * @param {string} root @param {string} cacheRoot @param {string} namespace @param {string} key
 * @param {readonly string[]} [args] @param {NodeJS.ProcessEnv} [env] */
export function authorBundleUseLine(root,cacheRoot,namespace,key,args=process.argv.slice(2),env=process.env) {
  const epoch=env.WS_AUTHOR_BUNDLE_USAGE;
  if(epoch===undefined)return undefined;
  if(!/^[A-Za-z0-9_-]{1,80}:[A-Za-z0-9_-]{1,40}$/u.test(epoch)
    ||![namespace,key].every(value=>/^[a-f0-9]{64}$/u.test(value)))return undefined;
  const compiler=args.length===1&&args[0]==='--prepare-compiler';
  const selected=args.find(arg=>arg.startsWith('--output='))?.slice(9);
  const slug=selected??(args[1]===undefined?'':basename(args[1]));
  const product=['build','validate'].includes(args[0]??'')&&/^[a-z0-9_-]+$/u.test(slug);
  return AUTHOR_BUNDLE_USE_PREFIX+JSON.stringify({schema:'author-bundle-use/1',root:resolve(root),cacheRoot:resolve(cacheRoot),
    epoch,namespace,key,purpose:compiler?'compiler':product?'product':'unknown',product:product?slug:null});
}
