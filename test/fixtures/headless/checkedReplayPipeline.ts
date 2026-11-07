/** One checked replay request may run while its recorder captures the next
 * bounded part. A failed request is observed immediately and drains before
 * another part can be offered; no request or watchdog is replaced. */
export function checkedReplayPipeline<T>(consume:(part:T)=>Promise<void>):{
  offer:(part:T)=>Promise<void>;check:()=>void;finish:()=>Promise<void>;stop:()=>Promise<void>;
} {
  type Outcome={ok:true}|{ok:false;error:unknown};
  let pending:Promise<Outcome>|undefined,failure:{error:unknown}|undefined,closed=false,offering=false;
  const check=():void=>{if(failure!==undefined)throw failure.error;if(closed)throw new Error('Replay pipeline owner ended');};
  const drain=async():Promise<void>=>{
    const result=await pending;if(result!==undefined&&!result.ok)throw result.error;
  };
  return {check,offer:async part=>{
    check();if(offering)throw new Error('Replay pipeline already has a pending offer');offering=true;
    try{await drain();check();
      pending=(async():Promise<Outcome>=>{try{await consume(part);return {ok:true};}
        catch(error){failure={error};return {ok:false,error};}})();
    }finally{offering=false;}
  },finish:async()=>{check();if(offering)throw new Error('Replay pipeline has an unsettled offer');await drain();check();closed=true;},
    stop:async()=>{closed=true;await pending;}};
}
