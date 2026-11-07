// @vitest-environment happy-dom
import {afterEach,expect,test,vi} from 'vitest';
import {Scope} from '../../../shared/engine/app/scope';
import {buildOfflineRow,installOfflineDownload} from './offlineDownload';
import {engineString} from '../../../shared/engine/strings';

interface VisibilityControl { disconnected:boolean; show:(target:Element,isIntersecting:boolean)=>void }
let current:VisibilityControl|undefined;
class Observer implements IntersectionObserver {
  readonly root=null;readonly rootMargin='0px';readonly scrollMargin='0px';readonly thresholds=[0];
  private readonly state:VisibilityControl;
  constructor(notify:IntersectionObserverCallback){
    this.state={disconnected:false,show:(target,isIntersecting)=>{
      const rect=new DOMRect();notify([{target,isIntersecting,boundingClientRect:rect,intersectionRect:rect,intersectionRatio:isIntersecting?1:0,rootBounds:null,time:0}],this);
    }};
    current=this.state;
  }
  observe():void{ /* Visibility is supplied by the test. */ }
  unobserve():void{ /* No native registration exists. */ }
  disconnect():void{this.state.disconnected=true;}
  takeRecords():IntersectionObserverEntry[]{return [];}
}
afterEach(()=>{vi.unstubAllGlobals();document.body.replaceChildren();current=undefined;});

async function settled():Promise<void>{for(let i=0;i<8;i++)await Promise.resolve();}

test('hidden offline rows do no admission, cancel on hide and ignore retired estimates',async()=>{
  vi.stubGlobal('IntersectionObserver',Observer);
  const owners:Scope[]=[],complete:((bytes:number|null)=>void)[]=[];
  const size=vi.fn((owner:Scope)=>{owners.push(owner);return new Promise<number|null>(resolve=>{complete.push(resolve);});});
  installOfflineDownload({size,start:()=>Promise.resolve('done')});
  const owner=new Scope('offline-row-test');
  try{
    const row=buildOfflineRow(owner);if(row===null)throw new Error('Missing offline row');
    document.body.append(row);const observer=current;if(observer===undefined)throw new Error('Missing visibility observer');
    const button=row.querySelector('button');if(button===null)throw new Error('Missing download button');
    row.refresh();await settled();expect(size).not.toHaveBeenCalled();
    observer.show(row,true);await settled();expect(size).toHaveBeenCalledTimes(1);
    row.refresh();await settled();expect(size).toHaveBeenCalledTimes(1);
    observer.show(row,false);expect(owners[0]?.disposed).toBe(true);
    complete[0]?.(1_000_000);await settled();expect(button.disabled).toBe(true);expect(button.textContent).toBe(engineString('s_offline_sizing'));
    observer.show(row,true);await settled();expect(size).toHaveBeenCalledTimes(2);
    complete[1]?.(4_200_000);await settled();expect(button.textContent).toBe(engineString('s_offline_download',['4']));expect(button.disabled).toBe(false);
    observer.show(row,false);observer.show(row,true);await settled();expect(size).toHaveBeenCalledTimes(3);
    row.inert=true;await vi.waitFor(()=>{expect(owners[2]?.disposed).toBe(true);});
    row.inert=false;await vi.waitFor(()=>{expect(size).toHaveBeenCalledTimes(4);});
    owner.dispose();expect(observer.disconnected).toBe(true);observer.show(row,true);await settled();expect(size).toHaveBeenCalledTimes(4);
  }finally{owner.dispose();}
});

test('hiding the size row does not cancel an explicit download',async()=>{
  vi.stubGlobal('IntersectionObserver',Observer);
  let finish:(()=>void)|undefined;const start=vi.fn((_owner:Scope,progress:(done:number,total:number)=>void)=>{
    progress(1_000_000,2_000_000);return new Promise<'done'>(resolve=>{finish=()=>{resolve('done');};});
  });
  installOfflineDownload({size:()=>Promise.resolve(2_000_000),start});
  const owner=new Scope('offline-explicit-test');
  try{
    const row=buildOfflineRow(owner);if(row===null)throw new Error('Missing offline row');document.body.append(row);
    const observer=current;if(observer===undefined)throw new Error('Missing visibility observer');observer.show(row,true);await settled();
    const button=row.querySelector('button');if(button===null)throw new Error('Missing download button');button.click();await settled();
    expect(start).toHaveBeenCalledOnce();observer.show(row,false);expect(owner.disposed).toBe(false);expect(start.mock.calls[0]?.[0]).toBe(owner);
    finish?.();await settled();expect(row.textContent).toContain(engineString('s_offline_done'));
  }finally{owner.dispose();}
});
