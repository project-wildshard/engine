import {expect,test} from 'vitest';
import {Scope} from '../../../../shared/engine/app/scope';
import {PresentationState,type ForegroundView,type ViewState} from './presentation';

function fixture(){const scope=new Scope('presentation-test'),view=new PresentationState();view.bindGate(scope,()=>true);return {scope,view};}
test('coverage and the existing gate select one foreground state',()=>{
  const f=fixture();let ready=true;f.view.bindGate(f.scope,()=>ready);
  try{f.view.setCoverage('play');expect(f.view.state).toBe('play');ready=false;f.view.refresh();expect(f.view.state).toBe('covered');ready=true;f.view.refresh();expect(f.view.state).toBe('play');f.view.setCoverage('still');expect(f.view.state).toBe('still');}finally{f.scope.dispose();}
});
test('hidden overrides presentation while foreground changes remain observable',()=>{
  const f=fixture(),seen:[ViewState,ForegroundView][]=[];f.view.observe(f.scope,(state,front)=>{seen.push([state,front]);});
  try{f.view.setCoverage('play');f.view.setVisible(false);f.view.setCoverage('still');expect(f.view.state).toBe('hidden');expect(seen.at(-1)).toEqual(['hidden','still']);f.view.setVisible(true);expect(f.view.state).toBe('still');}finally{f.scope.dispose();}
});
test('unchanged inputs and refreshes allocate no new notifications',()=>{
  const f=fixture(),seen:string[]=[];f.view.observe(f.scope,state=>{seen.push(state);});
  try{f.view.setCoverage('play');for(let i=0;i<100;i++){f.view.refresh();f.view.setCoverage('play');f.view.setVisible(true);}expect(seen).toEqual(['covered','play']);}finally{f.scope.dispose();}
});
test('retiring an old gate cannot clear a newer game claim',()=>{
  const old=new Scope('old-game'),next=new Scope('next-game'),view=new PresentationState();view.bindGate(old,()=>false);view.bindGate(next,()=>true);view.setCoverage('play');old.dispose();expect(view.state).toBe('play');next.dispose();expect(view.state).toBe('covered');
});
test('retired observers never run on a later show',()=>{
  const f=fixture(),observer=f.scope.child('observer'),seen:string[]=[];f.view.observe(observer,state=>{seen.push(state);});observer.dispose();f.view.setVisible(false);f.view.setVisible(true);expect(seen).toEqual(['covered']);f.scope.dispose();
});
test('an unclaimed or retired gate never starts world presentation',()=>{
  const view=new PresentationState(),scope=new Scope('retired-gate');scope.dispose();view.bindGate(scope,()=>true);view.setCoverage('play');expect(view.state).toBe('covered');
});
