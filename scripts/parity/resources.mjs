/** Browser-side independent resource census (03 §2.4); called before page scripts. */
export function installResources() {
  const w=/** @type {Window} */ (window);
  /** @typedef {{id:number,target:EventTarget,type:string,callback:EventListenerOrEventListenerObject,capture:boolean,wrapped:EventListener,stack:string,abort?:()=>void,signal?:AbortSignal}} Entry */
  /** @type {Set<Entry>} */ const listeners=new Set();
  let listenerId=0;
  // oxlint-disable-next-line typescript/unbound-method -- Wrappers preserve the native receiver through call().
  const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
  // O12: each target's entries by capture + type, so add/remove never scan every listener on the page (the whole-set scan
  // was quadratic: Pine's admission adds thousands, and froze the Simulator soak 12-15 s)
  /** @type {WeakMap<EventTarget, Map<string, Entry[]>>} */ const index=new WeakMap();
  /** @param {EventTarget} target @param {string} type @param {boolean} capture */
  const slot=(target,type,capture)=>{let byKey=index.get(target);if(!byKey){byKey=new Map();index.set(target,byKey);}
    const key=(capture?'1:':'0:')+type;let list=byKey.get(key);if(!list){list=[];byKey.set(key,list);}return list;};
  /** @param {Entry} entry */
  const forget=(entry)=>{listeners.delete(entry);const list=slot(entry.target,entry.type,entry.capture),at=list.indexOf(entry);if(at!==-1)list.splice(at,1);
    if(entry.signal && entry.abort)remove.call(entry.signal,'abort',entry.abort);};
  EventTarget.prototype.addEventListener=/** @this {EventTarget} @param {string} type @param {EventListenerOrEventListenerObject|null} callback @param {boolean|AddEventListenerOptions} [options] */ function addEventListener(type,callback,options){
    if(!callback){add.call(this,type,callback,options);return;}
    const capture=typeof options==='boolean'?options:options?.capture??false;
    const prior=slot(this,type,capture).find((e)=>e.callback===callback);
    if(prior)return;
    const signal=typeof options==='object'?options.signal:undefined;
    if(signal?.aborted)return;
    const once=typeof options==='object' && options.once===true;
    /** @type {Entry} */ const entry={id:++listenerId,target:this,type,callback,capture,stack:new Error(`listener ${type}`).stack??'',wrapped(event){if(once)forget(entry);if(typeof callback==='function')callback.call(this,event);else callback.handleEvent(event);}};
    if(signal){entry.signal=signal;entry.abort=()=>forget(entry);add.call(signal,'abort',entry.abort,{once:true});}
    listeners.add(entry);slot(this,type,capture).push(entry);add.call(this,type,entry.wrapped,options);
  };
  EventTarget.prototype.removeEventListener=/** @this {EventTarget} @param {string} type @param {EventListenerOrEventListenerObject|null} callback @param {boolean|EventListenerOptions} [options] */ function removeEventListener(type,callback,options){
    const capture=typeof options==='boolean'?options:options?.capture??false;
    const entry=slot(this,type,capture).find((e)=>e.callback===callback);
    if(entry){forget(entry);remove.call(this,type,entry.wrapped,options);}else remove.call(this,type,callback,options);
  };
  /** @type {Map<number,string>} */ const timeouts=new Map(),intervals=new Map(),raf=new Map();
  const timeout=w.setTimeout.bind(w),interval=w.setInterval.bind(w),clearTimeout=w.clearTimeout.bind(w),clearInterval=w.clearInterval.bind(w),request=w.requestAnimationFrame.bind(w),cancel=w.cancelAnimationFrame.bind(w);
  w.setTimeout=(handler,delay,...args)=>{
    const id=typeof handler==='function'?timeout(()=>{timeouts.delete(id);Reflect.apply(handler,window,args);},delay):timeout(handler,delay,...args);
    if(typeof handler!=='function')timeout(()=>{timeouts.delete(id);},delay);
    timeouts.set(id,new Error('timeout').stack??'');return id;
  };
  w.setInterval=(handler,delay,...args)=>{const id=interval(handler,delay,...args);intervals.set(id,new Error('interval').stack??'');return id;};
  w.clearTimeout=(id)=>{if(id!==undefined){timeouts.delete(id);intervals.delete(id);}clearTimeout(id);};
  w.clearInterval=(id)=>{if(id!==undefined){timeouts.delete(id);intervals.delete(id);}clearInterval(id);};
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve the native rAF callback API while removing its pending entry before invocation.
  w.requestAnimationFrame=(callback)=>{const id=request((time)=>{raf.delete(id);callback(time);});raf.set(id,new Error('raf').stack??'');return id;};
  w.cancelAnimationFrame=(id)=>{raf.delete(id);cancel(id);};
  Object.assign(window,{__parityResources:()=>{
    const counts={window:0,document:0,canvas:0,other:0};
    /** @param {EventTarget} target @returns {keyof typeof counts} */
    const targetKind=target=>target===window?'window':target===document?'document':target instanceof HTMLCanvasElement?'canvas':'other';
    const listenerDetails=[...listeners].map(e=>({id:e.id,type:e.type,capture:e.capture,
      kind:targetKind(e.target),
      target:e.target.constructor.name,stack:e.stack}));
    for(const e of listenerDetails)counts[e.kind]++;
    return {listeners:counts,listenerDetails,timers:{timeouts:timeouts.size,intervals:intervals.size,raf:raf.size},timerIds:{timeouts:[...timeouts.keys()],intervals:[...intervals.keys()],raf:[...raf.keys()]},stacks:{listeners:[...listeners].slice(0,5).map((e)=>e.stack),timers:[...timeouts.values(),...intervals.values(),...raf.values()].slice(0,5)}};
  }});
}
