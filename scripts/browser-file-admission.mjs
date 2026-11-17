// Test workers may wait for a browser slot before collection/case clocks.
// Physical launches spend that held slot one at a time; teardown never frees
// a reservation while its browser remains open.

/** @param {()=>Promise<import('./cpu-admission.mjs').CpuLease>} acquire */
export function createBrowserAdmissions(acquire){
 /** @typedef {{lease:import('./cpu-admission.mjs').CpuLease,inUse:boolean,closing:Promise<void>|null}} Held */
 /** @type {Held|null} */let held=null;
 /** @type {Promise<import('./cpu-admission.mjs').CpuLease>|null} */let pending=null;
 async function holdForFile(){
  if(held!==null||pending!==null)throw new Error('This worker already holds or awaits browser admission');
  pending=(async()=>{
   const lease=await acquire(),file={lease,inUse:false,closing:/** @type {Promise<void>|null} */(null)};
   held=file;
   return{...lease,release:async()=>{
    if(file.inUse)throw new Error('An owned browser must close before releasing file admission');
    file.closing??=(async()=>{await lease.release();if(held===file)held=null;})();
    await file.closing;
   }};
  })();
  try{return await pending;}finally{pending=null;}
 }
 async function forLaunch(){
  if(pending!==null)await pending;
  const file=held;
  if(file===null)return acquire();
  if(file.closing!==null)throw new Error('Browser file admission is closing; no new launch');
  if(file.inUse)throw new Error('This reserved worker already owns a browser; use contexts or close it first');
  file.inUse=true;let released=false;
  return{lost:file.lease.lost,release:()=>{
   if(!released){released=true;file.inUse=false;}
   return Promise.resolve();
  }};
 }
 return{holdForFile,forLaunch};
}
