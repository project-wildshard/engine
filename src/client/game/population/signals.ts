import type { Scope } from '@wildshard/engine/app/scope';
import type { PageGroupRows } from '@wildshard/format/creatures';
import type { ShardContext } from '../plugin/context';
import { wirePage } from '../shardfile/wirePage';
import { GroupNotices } from '../../../shared/game/population/groupNotices';

/** Rejoin the existing sound/panic consumers. Notices and knockdown are data
 * for the UI owner; this bridge constructs no view and changes no layout. */
export function installPopulationSignals(ctx: ShardContext, scope: Scope, effects: PageGroupRows['effects']): void {
  const notices=effects===undefined?null:new GroupNotices(effects);
  const notice=(text:string|null):void=>{if(text!==null)ctx.app.events.emit('creature.notice',{text});};
  wirePage.whenLive(scope,client=>client.onView(view=>{
    const [x,zOrY,third]=view.args;
    if(typeof x!=='number'||typeof zOrY!=='number')return;
    if(view.name.startsWith('creature.signal:')) {
      const name=view.name.slice('creature.signal:'.length);
      ctx.app.events.emit('creature.signal',{name,x,z:zOrY});notice(notices?.signal(name,view.tick/60)??null);
    } else if(view.name.startsWith('creature.sound:')&&typeof third==='number') {
      ctx.app.events.emit('creature.sound',{cue:view.name.slice('creature.sound:'.length),x,y:zOrY,z:third});
    } else if(view.name==='creature.knockdown'&&typeof third==='number') {
      ctx.app.events.emit('creature.knockdown',{x,z:zOrY,strength:third});notice(notices?.knockdown(view.tick/60)??null);
    }
  }));
}
