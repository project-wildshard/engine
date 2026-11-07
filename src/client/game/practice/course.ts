import * as THREE from 'three';
import { app } from '@wildshard/engine/app/runtime';
import { practiceFps } from '@wildshard/engine/core/tier';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { PlaygroundChip, clock, playgroundActive } from '@wildshard/engine/practice/playground/hud';
import { PLAYGROUND_Y, type Playground, type PlaygroundHost } from '@wildshard/engine/practice/playground/Playground';
import type { RoomMap, RoomMarker } from '@wildshard/engine/ui/roomMap';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { parsePracticeController, type PracticeControllerRows, type RidingPracticeLayout, type HookPracticeLayout } from '@wildshard/format/practiceCourseRows';
import { isJsonData } from '@wildshard/format/json';
import type { GrappleCourseRow } from '@wildshard/format/grapple';
import type { ShardContext } from '../plugin/context';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { pageRidingMount } from '../riding/client';
import { GrappleTool } from '../grapple/tool';
import { buildPracticeScene } from './scene';
import { NumericCourse } from './numericCourse';

const fill = (text:string, values:Readonly<Record<string,string|number>>):string => text.replaceAll(/\{(\w+)\}/gu,(match,key:string)=>String(values[key]??match));
/** Data only: both actual course files carry the same native-controller contract. */
export interface PracticeCourseRows {
  readonly kind:'horse'|'grapple';
  readonly layout:RidingPracticeLayout|HookPracticeLayout;
}
/** One row-driven native entry and numeric/HUD controller over the original borrowed owners. */
class CourseController {
  readonly map:RoomMap;
  private readonly run:NumericCourse;
  private horse:Animal|null=null;
  private readonly entry:{mount:ReturnType<typeof pageRidingMount>;rows:Extract<PracticeControllerRows['entry'],{kind:'mount'}>;road:(readonly[number,number])[]}|{course:GrappleCourseRow};
  constructor(private readonly host:PlaygroundHost,layout:PracticeCourseRows['layout'],program:ReturnProgram,mount:ReturnType<typeof pageRidingMount>|null,
    private readonly rows:PracticeControllerRows,private readonly room:PracticeCourse,map:RoomMap) {
    const row=rows.entry;
    this.run=new NumericCourse(host,room.origin,layout,program,()=>app.clock.now);
    const o=room.origin;
    if(row.kind==='mount'){
      if(mount===null)throw new Error('Practice needs its entered mount');
      const lap=row.road.map(([x,z])=>[o.x+x,o.z+z]as const);
      this.entry={mount,rows:row,road:[...lap,...lap.slice(1)]};
      const mark:RoomMarker={x:0,z:0},marks=[mark],none:RoomMarker[]=[];
      this.map={...map,markers:()=>{const h=this.horse;if(h===null||h.hidden)return none;mark.x=h.position.x;mark.z=h.position.z;return marks;}};
    }else{
      this.entry={course:{name:room.title,hooks:row.hooks.map(h=>new THREE.Vector3(o.x+h.x,o.y+h.y,o.z+h.z))}};
      this.map=map;
    }
  }
  private tool():GrappleTool {
    const tool=this.host.game.app.equipment?.tools.find(item=>item instanceof GrappleTool);
    if(!(tool instanceof GrappleTool))throw new Error('Hook practice needs the equipped grapple tool');return tool;
  }
  private get available():boolean {return 'course' in this.entry||this.horse!==null;}
  enter():void {
    const entry=this.entry;
    if('course' in entry){this.tool().setGrappleCourse(entry.course);return;}
    const row=entry.rows,o=this.room.origin,horse=this.horse??=this.host.animals.spawn(row.actor.kind,o.x+row.start.x,o.z+row.start.z,row.start.yaw,row.actor.variant);
    horse.hidden=false;horse.mesh.visible=true;
    entry.mount.addMountable(horse.entityId,row.actor.name);entry.mount.setRoads([entry.road]);
  }
  exit():void {
    const entry=this.entry,horse=this.horse;
    if('mount' in entry&&horse!==null){const mount=entry.mount;if(mount.horse===horse)mount.dismount();mount.removeMountable(horse.entityId);mount.setRoads(null);horse.hidden=true;horse.mesh.visible=false;}
  }
  afterExit():void {if('course' in this.entry)this.tool().setGrappleCourse(null);}
  events(active:boolean):void {if('course' in this.entry)app.events.emit('practice.active',active);}
  restart():void {
    if(!this.available)return;
    const entry=this.entry,a=this.horse;
    if('mount' in entry&&a!==null){
      if(entry.mount.horse===a)entry.mount.dismount();
      const o=this.room.origin,start=entry.rows.start,x=o.x+start.x,z=o.z+start.z;
      a.place(x,z,start.yaw);
      a.yOffset=PLAYGROUND_Y-heightAt(x,z);
      a.position.y=PLAYGROUND_Y;
      a.levelGround=true;
      a.hp=a.maxHp;
      a.speed=0;
      a.setMotion(start.yaw,0,2);
      a.mesh.position.copy(a.position);
    }
    this.run.reset();this.room.chip.status(this.rows.view.words.ready);this.room.chip.time(0,this.run.best);
  }
  private observe():boolean {
    const entry=this.entry,a=this.horse;
    if(!('mount' in entry)||a===null)return false;
    if(entry.mount.horse!==a){a.levelGround=true;a.yOffset=PLAYGROUND_Y-heightAt(a.position.x,a.position.z);}
    return this.host.player.mountedOn===a;
  }
  private pad(index:number):string {
    const view=this.rows.view,pad=view.kind==='checkpoints'?view.pads[index]:undefined;
    if(pad===undefined)throw new Error('Invalid practice checkpoint');return pad;
  }
  update(dt:number):void {
    if(!this.available)return;
    const player=this.host.player;if(player.hover)player.setHover(false);
    const mounted=this.observe(),now=app.clock.now,lap=this.run.state.lap;
    const out=this.run.step(dt,{now,mounted:Number(mounted)}),view=this.rows.view,state=this.run.state;
    if(view.kind==='laps'){
      const labels=view.words;
      if(Object.keys(out).length>0){
        if(out['courseFell']===1){this.restart();this.host.toast(labels.fell);return;}
        const notice=out['courseEvent'];
        if(notice===1||notice===2)this.host.toast(fill(notice===1?labels.lapNotice:labels.halfNotice,
          {lap,time:clock(notice===1?state.last:state.running?now-state.started:0),best:state.best===state.last?labels.best:''}));
      }
      this.room.chip.time(this.run.time(now),this.run.best);
      this.room.chip.status(!mounted&&!state.running?labels.ready:!state.running?labels.ride:
        fill(labels.lap,{lap:state.lap,half:state.half?labels.half:'',last:state.last<0?'':fill(labels.last,{time:clock(state.last)})}),state.running||mounted?'go':undefined);
    }else{
      const labels=view.words,index=out['pad']??-1,pad=index<0?null:this.pad(index);
      if(Object.keys(out).length>0){
        if(out['finish']===1){const time=clock(state.elapsed);this.room.chip.status(fill(labels.finish,{time}),'done');this.host.toast(fill(labels.done,{time,best:this.run.best===state.elapsed?labels.best:''}));}
        else if(state.phase===1)this.room.chip.status(pad!==null?fill(labels.running,{pad}):fill(labels.between,{reached:out['reached']??0,goals:view.goals}),'go');
        if(out['fell']===1){const checkpoint=this.pad(state.checkpoint);this.run.place(out);this.host.toast(fill(labels.fell,{pad:checkpoint}));}
      }
      this.room.chip.time(this.run.time(state.phase===1?app.clock.now:0),this.run.best);
    }
  }
}

/** Client-only common room lifetime, shared by the real riding and grapple courses.
 * The common controller consumes finite rows; native entry adapters retain body/tool authority. */
export class PracticeCourse implements Playground {
  readonly id:'horse'|'grapple'; readonly title:string; readonly center:{x:number;z:number};
  readonly root:THREE.Group; readonly map:RoomMap; readonly origin:THREE.Vector3; readonly chip:PlaygroundChip;
  private active=false;
  private readonly controller:CourseController;
  constructor(private readonly host:PlaygroundHost,ctx:ShardContext,input:PracticeCourseRows) {
    if(!isJsonData(input.layout))throw new Error('Practice rows require JSON data');
    const data=input.layout,row=parsePracticeController(data.controller),mount=row.entry.kind==='mount'?pageRidingMount(ctx):null;
    const program=ReturnProgram.page(data.program,ctx.scope.child('practice course program'));
    this.id=input.kind;this.title=row.title;
    this.center=row.center.kind==='fixed'?{x:row.center.x,z:row.center.z}:{...host.spawn};
    this.origin=new THREE.Vector3(this.center.x,PLAYGROUND_Y,this.center.z);
    const {root,colliders,map}=buildPracticeScene(data.presentation,this.origin,row.piece.id);
    this.root=root;root.visible=false;
    host.registry.add({id:row.piece.id,name:row.piece.name,category:'ground',file:row.piece.file,object:root,colliders,surface:row.piece.surface,solidFloor:true});
    this.chip=new PlaygroundChip(row.chip,()=>{this.restart();});
    this.controller=new CourseController(host,data,program,mount,row,this,map);
    this.map=this.controller.map;
    host.game.onUpdate(dt=>{if(this.active)this.controller.update(dt);},row.piece.id);
  }
  get entered():boolean{return this.active;}
  enter():void {
    this.active=true;app.setState('playground');this.root.visible=true;this.controller.enter();
    practiceFps.on=true;playgroundActive(true);this.controller.events(true);
    this.host.player.setHover(false);this.chip.show(true);this.restart();
  }
  exit():void {
    if(!this.active)return;
    this.active=false;app.setState('play');this.controller.exit();this.root.visible=false;
    this.chip.show(false);playgroundActive(false);this.controller.events(false);practiceFps.on=false;this.controller.afterExit();
  }
  restart():void {this.controller.restart();}
}
