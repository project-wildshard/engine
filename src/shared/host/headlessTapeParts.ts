import type {HeadlessTapePlan} from './headlessTape';
import type {HeadlessTapePartReport} from './tickProtocol';

/** One offline tape's aggregate allowance, retained across bounded requests.
 * Parent and worker both check it; splitting never grants a second allowance. */
export class TapePartBudget {
  private readonly ids=new Set<string>();
  private selection:string|undefined;
  private ticks=0;
  private commands=0;
  private bytes=0;
  private pending:HeadlessTapePlan['segments'][number]|undefined;
  private tick:number;
  constructor(tick:number){this.tick=tick;}
  admit(plan:HeadlessTapePlan):void {
    if(this.pending!==undefined)throw new Error('Tape part already pending');
    const segment=plan.segments[0],selection=JSON.stringify(plan.observe);
    if(plan.segments.length!==1||segment===undefined)throw new Error('A tape part requires exactly one segment');
    const commands=segment.frames?.reduce((sum,frame)=>sum+frame.length,0)??segment.commands.length;
    if(this.ids.has(segment.id)||this.ids.size>=128||this.ticks+segment.ticks>60_000||this.commands+commands>60_000)
      throw new Error('Tape part aggregate allowance exceeded');
    if(this.selection!==undefined&&selection!==this.selection)throw new Error('Tape part observation selection changed');
    this.selection=selection;this.ids.add(segment.id);this.ticks+=segment.ticks;this.commands+=commands;this.pending=segment;
  }
  accept(value:HeadlessTapePartReport):void {
    const segment=this.pending,report=value.report,observation=report.observations[0];
    if(segment===undefined||report.observations.length!==1||observation?.id!==segment.id
      ||report.ticks>segment.ticks||(segment.route===undefined&&report.ticks!==segment.ticks)
      ||value.commit.tick!==this.tick+report.ticks||observation.tick!==value.commit.tick)
      throw new Error('Tape part did not commit its complete ordered input');
    const bytes=new TextEncoder().encode(JSON.stringify(observation)).byteLength;
    if(this.bytes+bytes>8_000_000)throw new Error('Tape part observation allowance exceeded');
    this.bytes+=bytes;this.tick=value.commit.tick;this.pending=undefined;
  }
}
