import type {Scope} from '../../../../shared/engine/app/scope';
import type {PresentationState} from './presentation';

interface LoopPorts {
  readonly draw:(now:number|undefined,forced:boolean)=>void;
  readonly parked:()=>void;
}
/** A parked world owns no frame request. Explicit loader frames are counted separately. */
export class PresentationLoop {
  private readonly scope:Scope;
  private readonly view:PresentationState;
  private readonly ports:LoopPorts;
  private frame:number|undefined;
  private waking=false;
  private prime=false;
  private drawing=false;
  private active=false;
  constructor(scope:Scope,view:PresentationState,ports:LoopPorts){
    this.scope=scope;this.view=view;this.ports=ports;
    // The loop's lifetime claims the world. Asynchronous gameplay readiness
    // is checked by draw; caching it as coverage can park its only wake-up.
    view.bindGate(scope,()=>true);
    view.observe(scope,()=>{this.reconcile();});
  }
  private reconcile():void{
    if(this.view.state!=='play'){
      if(this.frame!==undefined){this.scope.cancelRaf(this.frame);this.frame=undefined;}
      if(this.active){this.active=false;this.ports.parked();}return;
    }
    if(this.frame===undefined&&!this.scope.disposed&&!this.scope.disposing){
      if(!this.active){this.active=true;this.ports.parked();}
      this.frame=this.scope.raf(now=>{
        this.frame=undefined;this.view.refresh();
        if(this.view.state!=='play')return;
        const forced=this.prime;this.prime=false;this.present(now,forced);this.reconcile();
      });
    }
  }
  private present(now:number|undefined,forced:boolean):void{
    if(this.drawing||this.scope.disposed||this.scope.disposing||this.view.state==='hidden')return;
    this.drawing=true;try{this.ports.draw(now,forced);}finally{this.drawing=false;}
  }
  /** UI disposal can run before the caller clears its pause flag: sample after that task finishes. */
  wake():void{
    if(this.waking||this.scope.disposed||this.scope.disposing)return;
    this.waking=true;
    queueMicrotask(()=>{this.waking=false;if(this.scope.disposed||this.scope.disposing)return;this.view.refresh();this.reconcile();});
  }
  primeFrame():void{this.prime=true;this.wake();}
  /** FC2's synchronous, explicit warm-up call never starts a covered loop. */
  hiddenFrame():void{this.present(undefined,true);}
  /** A glass hold captures its one still after the layer's ownership has settled. */
  stillFrame():void{
    queueMicrotask(()=>{if(this.view.state==='still')this.hiddenFrame();});
  }
}
