import * as v from 'valibot';

const reply = v.object({id:v.optional(v.number()),result:v.optional(v.unknown()),error:v.optional(v.object({message:v.string()}))});
const targets = v.object({targetInfos:v.array(v.object({targetId:v.string(),type:v.string(),url:v.string()}))});

/** Send ordinary trusted Escape input to an existing agent-browser page.
 * The CLI's native Escape mapping floods macOS with Unidentified/Minus keys;
 * CDP's standard Windows key code works without a native-platform override.
 * This connection detaches without closing the harness's page or browser.
 * @param {string} endpoint Browser WebSocket from agent-browser get cdp-url.
 * @param {string} url Exact current page URL, to avoid selecting another tab. */
export async function pressEscape(endpoint,url) {
  const socket = new WebSocket(endpoint);
  /** @type {Map<number,{resolve:(value:unknown)=>void,reject:(error:Error)=>void,timer:ReturnType<typeof setTimeout>}>} */
  const pending = new Map();
  let id = 0;
  const fail = (/** @type {Error} */ error) => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  };
  socket.addEventListener('message',event => {
    try {
      const message = v.parse(reply,JSON.parse(String(event.data)));
      if (message.id === undefined) return;
      const entry = pending.get(message.id); if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    } catch (error) { fail(new Error(`Invalid browser reply: ${String(error)}`)); }
  });
  socket.addEventListener('close',() => { fail(new Error('Browser input connection closed')); });
  /** @param {string} method @param {Record<string,unknown>} params @param {string} [sessionId] @returns {Promise<unknown>} */
  const send = (method,params,sessionId) => new Promise((resolve,reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timed out`)); },10000);
    pending.set(key,{resolve,reject,timer});
    socket.send(JSON.stringify({id:key,method,params,...sessionId === undefined ? {} : {sessionId}}));
  });
  try {
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => { reject(new Error('Browser input connection timed out')); },10000);
      socket.addEventListener('open',() => { clearTimeout(timer); resolve(undefined); },{once:true});
      socket.addEventListener('error',() => { clearTimeout(timer); reject(new Error('Browser input connection failed')); },{once:true});
    });
    const page = v.parse(targets,await send('Target.getTargets',{})).targetInfos.find(target => target.type === 'page' && target.url === url);
    if (!page) throw new Error('Exact browser input page is absent');
    const {sessionId} = v.parse(v.object({sessionId:v.string()}),await send('Target.attachToTarget',{targetId:page.targetId,flatten:true}));
    try {
      for (const type of ['rawKeyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
    } finally { await send('Target.detachFromTarget',{sessionId}); }
  } finally { socket.close(); }
}
