import type {Scope} from '../../../../shared/engine/app/scope';
import {emitFault} from '../../../../shared/engine/core/faults';

export type ForegroundView='play'|'still'|'covered';
export type ViewState=ForegroundView|'hidden';
type Listener=(state:ViewState,foreground:ForegroundView)=>void;
/** One page presentation decision. Changing hidden foreground coverage still notifies audio/activity owners. */
export class PresentationState {
  private coverage:ForegroundView='covered';
  private visible=true;
  private gate:{read:()=>boolean}|undefined;
  private foreground:ForegroundView='covered';
  private mode:ViewState='covered';
  private readonly listeners=new Set<Listener>();
  get state():ViewState{return this.mode;}
  get front():ForegroundView{return this.foreground;}
  setVisible(visible:boolean):void{if(this.visible!==visible){this.visible=visible;this.refresh();}}
  setCoverage(coverage:ForegroundView):void{if(this.coverage!==coverage){this.coverage=coverage;this.refresh();}}
  bindGate(scope:Scope,read:()=>boolean):void{
    if(scope.disposed||scope.disposing)return;
    const claim={read};this.gate=claim;
    scope.onDispose(()=>{if(this.gate===claim){this.gate=undefined;this.refresh();}});this.refresh();
  }
  refresh():void{
    const foreground=this.coverage==='play'&&this.gate?.read()!==true?'covered':this.coverage;
    const mode=this.visible?foreground:'hidden';
    if(mode===this.mode&&foreground===this.foreground)return;
    this.mode=mode;this.foreground=foreground;
    for(const listener of this.listeners){
      if(!this.listeners.has(listener))continue;
      try{listener(mode,foreground);}catch(error){emitFault({system:'view.state',error,verdict:'uncaught'});}
    }
  }
  observe(scope:Scope,listener:Listener):void{
    if(scope.disposed||scope.disposing)return;
    const run:Listener=(mode,foreground)=>{if(!scope.disposed&&!scope.disposing)scope.run(()=>{listener(mode,foreground);});};
    this.listeners.add(run);scope.onDispose(()=>{this.listeners.delete(run);});run(this.mode,this.foreground);
  }
}
/** Pure page state; the browser and UI installers supply its inputs explicitly. */
export const pagePresentation:PresentationState=new PresentationState();
