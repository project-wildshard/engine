// Manual proof only: add a wait inside the real SW's measured cache boundary.
// Served in memory; no production source, cache policy or build output changes.
import { createServer, get } from 'node:http';
import assert from 'node:assert/strict';
import ts from '@typescript/typescript6';

/** @param {string} upstream @param {string} kind @param {number} ms */
export async function bootTimingDelay(upstream,kind,ms) {
  let matches=0;
  const server=createServer((request,response)=>{
    const path=request.url??'/';
    const pathname=new URL(path,upstream).pathname;
    const forward=()=>{
    const forwarded=get(new URL(path,upstream),{headers:{...request.headers,host:new URL(upstream).host,'accept-encoding':'identity'}},incoming=>{
      const headers={...incoming.headers};
      const inject=kind==='server'?/serverWorker[^/]*\.js$/u.test(pathname):pathname.startsWith('/sw-core/');
      if(!inject) {response.writeHead(incoming.statusCode??502,headers);incoming.pipe(response);return;}
      /** @type {Buffer[]} */ const chunks=[];
      incoming.on('data',chunk=>{chunks.push(Buffer.from(chunk));});
      incoming.on('end',()=>{
        let source=Buffer.concat(chunks).toString('utf8');
        matches++;
        if(kind==='server') {
          // Locate the actual measured callback in emitted JS, independent of
          // minified symbol names. Only its existing work gets the test wait.
          const file=ts.createSourceFile('worker.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
          /** @type {import('@typescript/typescript6').ArrowFunction|undefined} */ let callback;
          /** @param {import('@typescript/typescript6').Node} node */
          const visit=node=>{
            if(ts.isCallExpression(node)) {
              const [operation,work]=node.arguments;
              if(operation && (ts.isStringLiteral(operation)||ts.isNoSubstitutionTemplateLiteral(operation)) && operation.text==='server:world-boot' && work && ts.isArrowFunction(work)) callback=work;
            }
            ts.forEachChild(node,visit);
          };
          visit(file);assert.ok(callback && !ts.isBlock(callback.body),'Missing actual server world callback');
          source=`${source.slice(0,callback.getStart(file))}async () => {await new Promise(resolve => {setTimeout(resolve,${ms});});return (${callback.body.getText(file)});}${source.slice(callback.end)}`;
        } else {
          const target=kind==='sw-open'?'() => store(name)':'() => cache.put(request, response.clone())';
          assert.ok(source.includes(target),`Missing actual SW boundary: ${target}`);
          source=source.replace(target,`async () => { await new Promise(resolve => {setTimeout(resolve,${ms});}); return (${target})(); }`);
        }
        delete headers['content-length'];delete headers['content-encoding'];delete headers.etag;
        response.writeHead(incoming.statusCode??502,headers);response.end(source);
      });
    });
    forwarded.on('error',()=>{response.writeHead(502);response.end();});
    };
    forward();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{resolve(undefined);});});
  const address=server.address();assert.ok(address && typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}`,matched:()=>matches>0,close:()=>{server.closeAllConnections();server.close();}};
}
