import type {Scope} from '../../../shared/engine/app/scope';
import type {PresentationState,ForegroundView,ViewState} from '../app/view/presentation';
import {diagnosticNow} from '../../../shared/engine/core/clock';
import {emitFault} from '../../../shared/engine/core/faults';

type Context=EventTarget&Pick<AudioContext,'state'|'resume'|'suspend'>;
/** One hardware policy for the page's existing context. No context is made by this service. */
export class AudioActivity {
  private readonly scope:Scope;
  private readonly now:()=>number;
  private context:Context|undefined;
  private contextScope:Scope|undefined;
  private view:ViewState='covered';
  private foreground:ForegroundView='covered';
  private coveredAt:number|undefined;
  private timer:ReturnType<Scope['timeout']>|undefined;
  private wanted=false;
  private denied=false;
  private failed=false;
  private pending:{action:'resume'|'suspend'}|undefined;
  constructor(scope:Scope,presentation:PresentationState,now:()=>number=diagnosticNow){
    this.scope=scope;this.now=now;
    presentation.observe(scope,(view,front)=>{
      if(view!==this.view)this.denied=false;
      this.view=view;this.foreground=front;
      if(front==='play')this.coveredAt=undefined;else this.coveredAt??=now();
      this.update();
    });
  }
  attach(context:Context|undefined):void{
    if(this.context===context)return;
    this.contextScope?.dispose();this.clearTimer();this.pending=undefined;
    this.context=context;this.failed=false;this.denied=false;this.wanted=context?.state==='running';
    if(context!==undefined){
      this.contextScope=this.scope.child('audio.activity.context');
      this.contextScope.listen(context,'statechange',()=>{this.update();});
    }
    this.update();
  }
  /** Called in the player's gesture; resume is invoked synchronously, never after an async turn. */
  resume():void{this.wanted=true;this.denied=false;this.update();}
  private clearTimer():void{if(this.timer!==undefined){this.scope.cancelTimer(this.timer);this.timer=undefined;}}
  private update():void{
    this.clearTimer();
    const ctx=this.context;
    if(this.scope.disposed||this.scope.disposing||ctx===undefined||ctx.state==='closed')return;
    const remaining=this.coveredAt===undefined?Infinity:5000-(this.now()-this.coveredAt);
    const allowed=this.view!=='hidden'&&(this.foreground==='play'||remaining>0);
    if(allowed&&this.foreground!=='play'&&(this.wanted||ctx.state==='running')){
      this.timer=this.scope.timeout(remaining,()=>{this.timer=undefined;this.update();});
    }
    const action=allowed?'resume':'suspend';
    if(action==='resume'&&(!this.wanted||this.denied))return;
    if(action==='suspend'&&this.failed)return;
    if(this.pending?.action===action)return;
    if(this.pending===undefined&&(action==='resume'?ctx.state==='running':ctx.state==='suspended'))return;
    const claim:{action:'resume'|'suspend'}={action};this.pending=claim;
    const settle=(error?:unknown):void=>{
      if(this.context!==ctx||this.scope.disposed||this.scope.disposing||this.pending!==claim)return;
      this.pending=undefined;
      if(error!==undefined){
        if(action==='resume')this.denied=true;
        else {this.failed=true;emitFault({system:'audio.activity',error,verdict:'uncaught'});}
      }
      this.update();
    };
    const apply=async():Promise<void>=>{try{await ctx[action]();settle();}catch(error){settle(error);}};
    void apply();
  }
}
