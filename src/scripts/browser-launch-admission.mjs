/** Install once per Playwright BrowserType. Policy supplies a real browser lease;
 * this adapter owns exactly one lease per physical launch until close drains.
 * Connecting to an existing browser deliberately spends no second lease.
 * @param {object} type
 * @param {()=>Promise<{lost:Promise<void>,release:()=>Promise<void>}>} acquire
 * @param {(error:unknown,context?:{lost:boolean})=>void} [onFailure]
 */
export function installBrowserAdmission(type,acquire,onFailure=error=>{console.error('Browser admission drain failed:',error);}){
 const installed=Symbol.for('wildshard.browser-admission.installed.v1');
 if(Reflect.get(type,installed)===true)return;
 for(const method of ['launch','launchPersistentContext','launchServer']){
  const launch=Reflect.get(type,method);
  if(typeof launch!=='function')continue;
  Reflect.set(type,method,async function admittedLaunch(...args){
   const lease=await acquire();
   let lost=false,active=true;
   const reportFailure=(/** @type {unknown} */error)=>{onFailure(error,{lost});};
   const admissionLost=lease.lost.then(()=>{lost=true;return undefined;});
   void admissionLost.catch(reportFailure);
   let handle;
   try{
    await Promise.resolve();
    if(lost)throw new Error('Browser admission was lost before launch');
    handle=await launch.apply(this,args);
   }catch(error){
    try{await lease.release();}catch(releaseError){throw new AggregateError([error,releaseError],'Browser launch and lease cleanup failed',{cause:releaseError});}
    active=false;
    throw error;
   }
   const drain=handle.close;
   if(typeof drain!=='function')throw new Error('Browser launch returned no drain operation; lease retained');
   let closing;
   const close=(...closeArgs)=>{
    // Defer invocation so synchronous close/disconnect callbacks share this
    // promise instead of entering the physical close operation twice.
    closing??=Promise.resolve().then(async()=>{
     const result=await drain.apply(handle,closeArgs);
     await lease.release();active=false;
     if(lost)throw new Error('Browser admission was lost during owned work');
     return result;
    });
    return closing;
   };
   handle.close=close;
   void (async()=>{await admissionLost;if(active)await close();})().catch(reportFailure);
   for(const event of ['disconnected','close','exit'])handle.once(event,()=>{if(active)void close().catch(reportFailure);});
   if(lost){await close();throw new Error('Browser admission was lost while launching');}
   return handle;
  });
 }
 Reflect.set(type,installed,true);
}
