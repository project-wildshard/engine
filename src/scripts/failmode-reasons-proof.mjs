// FM7b1: actual native old/new WebSocket ends, with unchanged close codes and no game frames.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket as OldClient, WebSocketServer } from 'ws';

await import('./bake-loader.mjs');
const { SocketTransport } = await import('../server/host/dedicated/socketTransport.ts');
const { WebSocketTransport } = await import('../client/engine/net/webSocketTransport.ts');

/** @param {(socket: import('ws').WebSocket)=>void} send */
async function server(send) {
  const host = new WebSocketServer({host:'127.0.0.1',port:0});
  await once(host,'listening',{signal:AbortSignal.timeout(10000)});
  const address=host.address();
  if(typeof address==='string'||address===null)throw new Error('No owned native port');
  host.once('connection',send);
  return {url:`ws://127.0.0.1:${String(address.port)}/`,close:async()=>{
    const closed = once(host, 'close', {signal: AbortSignal.timeout(2000)}); host.close();
    try { await closed; } catch (error) {
      const forced = once(host, 'close', {signal: AbortSignal.timeout(2000)});
      for (const client of host.clients) client.terminate();
      await forced; throw new Error('Owned native sockets required forced cleanup', {cause:error});
    }
  }};
}
const modern=await server(socket=>{new SocketTransport(socket).close('full',{code:'queue',position:3});});
try {
  const legacy=new OldClient(modern.url), [code]=await once(legacy,'close',{signal:AbortSignal.timeout(10000)});
  assert.equal(code,4002); // old client ignores optional reason bytes and retains exactly its old behavior
}finally{await modern.close();}
for(const item of [
  {why:'refused',info:{code:/** @type {const} */ ('banned'),untilMs:4_000_000_000_000}},
  {why:'full',info:{code:/** @type {const} */ ('queue'),position:1,etaMs:2000}},
  {why:'refused',info:{code:/** @type {const} */ ('auth-expired')}},
]){
  const host=await server(socket=>{new SocketTransport(socket).close(item.why,item.info);});
  try {
    const client=new WebSocketTransport(host.url);
    const answer=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{client.close();reject(new Error('No native close result'));},10000);
      client.onClose((why,info)=>{clearTimeout(timer);resolve({why,info});});
    });
    assert.deepEqual(answer,item);
  }finally{await host.close();}
}
for(const text of ['', '{"v":2,"code":"queue"}', 'legacy words']){
  const host=await server(socket=>{socket.close(4002,text);});
  try {
    const client=new WebSocketTransport(host.url);
    const answer=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{client.close();reject(new Error('No legacy native close'));},10000);
      client.onClose((why,info)=>{clearTimeout(timer);resolve({why,info});});
    });
    assert.deepEqual(answer,{why:'full',info:null});
  }finally{await host.close();}
}
console.log('PASS old client/new server, new client/old server and unknown optional reasons; close codes unchanged, no new prefix or game frame');
