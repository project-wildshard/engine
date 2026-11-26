// Compiler execution identity: parse emitted JavaScript, never strip source
// comments with a regular expression. Raw source/content reads use other keys.
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import * as v from 'valibot';

const require=createRequire(import.meta.url);
const Cache=v.strictObject({key:v.string(),result:v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u)),seal:v.string()});
/** @type {typeof import('@typescript/typescript6')|undefined} */
let compiler;
/** Pure content normalization, never an input-validity or admission verdict.
 * @type {Map<string,string>} */
const normalized=new Map();
/** @param {Uint8Array|string} bytes */
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Every caller first validates the current raw digest. The read callback is
 * used only on a normalization miss and must still return those exact bytes.
 * @param {string} file @param {string} rawHash @param {()=>Uint8Array} read */
export function compilerCodeHash(file,rawHash,read) {
  const version=v.parse(v.object({version:v.string()}),require('@typescript/typescript6/package.json')).version;
  const directory=resolve(process.env.WILDSHARD_COMPILER_CODE_CACHE??resolve(homedir(),'.cache/wildshard/compiler-code/1'));
  const key=digest(JSON.stringify({schema:'compiler-code/2',typescript:version,file,rawHash})),memoryKey=`${directory}\0${key}`,cached=normalized.get(memoryKey);
  if(cached!==undefined)return cached;
  const at=resolve(directory,`${key}.json`);
  try {
    const saved=v.parse(Cache,JSON.parse(readFileSync(at,'utf8')));
    if(saved.key===key&&saved.seal===digest(JSON.stringify({key,result:saved.result}))) {
      normalized.set(memoryKey,saved.result);return saved.result;
    }
  } catch { /* Missing/corrupt pure transform memo: parse the verified bytes. */ }
  const bytes=read();
  if(digest(bytes)!==rawHash)throw new Error(`Compiler input changed while normalizing: ${file}`);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  // Loader macros and bundler annotations consume source text before normal
  // execution. Those modules stay byte-exact, including comment directives.
  if(['import.meta.glob','import.meta.env','@__PURE__','#__PURE__','@vite-ignore'].some(marker=>text.includes(marker)))return digest(`source-transform\0${rawHash}`);
  const ts=compiler ??= require('@typescript/typescript6');
  const emitted=ts.transpileModule(text,{
    fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,
      module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,allowJs:true,removeComments:true,
      sourceMap:false,inlineSourceMap:false},
  });
  // Invalid compiler source must never acquire a reusable semantic identity.
  if(emitted.diagnostics?.some(row=>row.category===ts.DiagnosticCategory.Error))throw new Error(`Invalid compiler module: ${file}`);
  const source=ts.createSourceFile('compiler.mjs',emitted.outputText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  /** @type {Array<[number,string]>} */
  const tokens=[];
  /** The parser knows regex/template/string boundaries, including their
   * meaningful internal whitespace; a trivia-skipping scanner alone does not.
   * @param {import('@typescript/typescript6').Node} node */
  const visit=node=>{
    const children=node.getChildren(source);
    if(children.length>0)for(const child of children)visit(child);
    else if(node.kind!==ts.SyntaxKind.EndOfFileToken)tokens.push([node.kind,node.getText(source)]);
  };
  visit(source);
  const result=digest(JSON.stringify({schema:'compiler-code/1',typescript:ts.version,tokens}));
  const temporary=resolve(directory,`${key}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    mkdirSync(directory,{recursive:true});
    const body={key,result};writeFileSync(temporary,JSON.stringify({...body,seal:digest(JSON.stringify(body))}));renameSync(temporary,at);
  } catch { /* A read-only/full cache must not change compilation semantics. */ }
  finally {try {rmSync(temporary,{force:true});}catch { /* Best-effort own temporary cleanup. */ }}
  normalized.set(memoryKey,result);return result;
}
