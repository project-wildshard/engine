// Plain source/build producer: title URLs name the original image bytes, never a build id.
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

/** @param {string} root @returns {Record<string,string>} */
export function titleAssetURLs(root) {
  const folder=join(root,'public/assets/title'),urls={};
  for(const name of readdirSync(folder).sort()) {
    if(!/\.(?:jpg|png|webp)$/.test(name))continue;
    const source=`/assets/title/${name}`;
    const hash=createHash('sha256').update(readFileSync(join(folder,name))).digest('hex');
    const existing=/-([a-f0-9]{12,64})\.[a-z]+$/.exec(name)?.[1];
    if(existing!==undefined&&!hash.startsWith(existing))throw new Error(`Title asset name differs from bytes: ${name}`);
    // The iOS launch image already names its bytes.
    const named=existing!==undefined?name:name.replace(/(\.[a-z]+)$/,`-${hash.slice(0,16)}$1`);
    urls[source]=`/assets/title/${named}`;
  }
  return urls;
}

/** @param {string} root @returns {Record<string,string>} */
export function titleAssetTables(root) {
  const urls=titleAssetURLs(root),table=JSON.stringify(urls,null,2);
  let html=readFileSync(join(root,'index.html'),'utf8');
  if(!/\/\/ BEGIN TITLE URLS\n[\s\S]*?\/\/ END TITLE URLS/.test(html))throw new Error('Missing title URL table markers');
  html=html.replace(/(\/\/ BEGIN TITLE URLS\n)[\s\S]*?([ \t]*\/\/ END TITLE URLS)/,
    `$1      const titleAssetURLs = ${JSON.stringify(urls)};\n$2`);
  for(const [source,url]of Object.entries(urls)) {
    const stem=source.replace(/\.[a-z]+$/,'');
    html=html.replaceAll(new RegExp(`url\\('(${stem}(?:-[a-f0-9]{16})?\\.[a-z]+)'\\)`,'g'),`url('${url}')`);
  }
  return {'scripts/title-assets.generated.json':`${table}\n`,'index.html':html};
}

/** Publish exact byte copies; authored manifests retain their logical source paths.
 * @param {string} root @param {string} outDir */
export function writeTitleAssets(root,outDir) {
  const urls=titleAssetURLs(root);
  const declared=readFileSync(join(root,'scripts/title-assets.generated.json'),'utf8');
  if(declared!==titleAssetTables(root)['scripts/title-assets.generated.json'])throw new Error('Stale title asset URLs: run pnpm gen:source');
  for(const [source,url]of Object.entries(urls)) {
    const target=join(outDir,url);mkdirSync(dirname(target),{recursive:true});
    copyFileSync(join(root,'public',source),target);
  }
}
