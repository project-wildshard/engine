/** One native carrier for owned frame requests. Queue storage is reused after its high-water mark. */
export interface FrameSchedulerPorts {
  frame: (render: FrameRequestCallback) => number;
  cancel: (id: number) => void;
  failed: (error: unknown) => void;
}
interface Slot { id: number; render: FrameRequestCallback | undefined }
export class SharedFrameScheduler {
  private readonly slots: Slot[]=[];
  private readonly free: number[]=[];
  private queue: number[]=[];
  private spare: number[]=[];
  private next=0;
  private count=0;
  private active=true;
  private dispatching=false;
  private native: number | undefined;
  private epoch=0;
  private drive=this.driver(0);
  private readonly ports: FrameSchedulerPorts;
  constructor(ports: FrameSchedulerPorts) {this.ports=ports;}
  get pending(): boolean { return this.native!==undefined; }
  frame(render: FrameRequestCallback): number {
    const index=this.free.pop()??this.slots.length,slot=this.slots[index]??{id:0,render:undefined};
    this.slots[index]=slot;slot.id=++this.next;slot.render=render;
    const id=slot.id;this.queue.push(index,id);this.count++;
    try{this.schedule();}catch(error){this.cancel(id);throw error;}
    return id;
  }
  cancel(id: number): void {
    for(let index=0;index<this.slots.length;index++){
      const slot=this.slots[index];
      if(slot?.id!==id||slot.render===undefined)continue;
      slot.render=undefined;slot.id=0;this.free.push(index);this.count--;break;
    }
    if(this.count===0){this.queue.length=0;if(this.native!==undefined)this.ports.cancel(this.native);this.native=undefined;}
  }
  setActive(active: boolean): void {
    if(this.active===active)return;this.active=active;
    if(!active){this.epoch++;this.drive=this.driver(this.epoch);if(this.native!==undefined)this.ports.cancel(this.native);this.native=undefined;}
    else this.schedule();
  }
  private schedule(): void {
    if(this.active&&!this.dispatching&&this.count>0&&this.native===undefined)this.native=this.ports.frame(this.drive);
  }
  private driver(epoch: number): FrameRequestCallback {
    return time=>{
      if(epoch!==this.epoch||!this.active)return;
      this.native=undefined;this.dispatching=true;
      const batch=this.queue;this.queue=this.spare;this.spare=batch;
      try{
        for(let at=0;at<batch.length;at+=2){
          if(!this.active){
            for(let rest=batch.length-2;rest>=at;rest-=2)this.queue.unshift(batch[rest]??-1,batch[rest+1]??0);
            break;
          }
          const index=batch[at]??-1,id=batch[at+1]??0,slot=this.slots[index];
          if(slot?.id!==id||slot.render===undefined)continue;
          const render=slot.render;slot.render=undefined;slot.id=0;this.free.push(index);this.count--;
          try{render(time);}catch(error){this.ports.failed(error);}
        }
      }finally{batch.length=0;this.dispatching=false;this.schedule();}
    };
  }
}
