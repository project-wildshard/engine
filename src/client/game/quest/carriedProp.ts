import * as THREE from 'three';
import { parseCarriedQuest, type CarriedQuestRows } from '@wildshard/format/questSteps';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { practiceRoom } from '@wildshard/engine/core/practiceRoom';
import { resourceScope } from '@wildshard/engine/app/resources';
import { Rng } from '@wildshard/engine/core/rng';
import { modelContext } from '@wildshard/engine/models/model';
import { defineSpecimenCatalogue } from '../models/specimenCatalogue';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { pageRidingMount } from '../riding/client';
import { commitQuestEffects } from '../../../shared/game/quest/effects';
import { boundQuestState } from '../../../shared/game/quest/boundState';
import type { ShardContext } from '../plugin/context';
import { carriedRound, carriedRoundCarrying, carriedRoundDue, carriedRoundFrame, carriedRoundGoal, carriedRoundHome, carriedRoundOutputs, type CarriedRound } from '../../../shared/game/quest/carriedRound';

/** Client-only projection of an existing carried-prop guest. The entered world,
 * mount, saved flags and page services are borrowed by their native identities. */
export class CarriedQuestProp {
  readonly object:THREE.Object3D;
  private readonly rows:CarriedQuestRows;
  private readonly brain:ReturnProgram;
  private readonly world:NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>;
  private readonly mount:ReturnType<typeof pageRidingMount>|null;
  private readonly entered:ShardContext['scope'];
  private readonly construction:ShardContext['scope'];
  private readonly runtime:NonNullable<ShardContext['game']['runtime']>;
  private readonly player:CarriedQuestProp['world']['player'];
  private readonly registry:CarriedQuestProp['world']['registry'];
  private readonly play:NonNullable<CarriedQuestProp['runtime']['play']>;
  private readonly quest:ReturnType<typeof boundQuestState>;
  private readonly flags:CarriedQuestProp['quest']['flags'];
  private readonly hud:CarriedQuestProp['play']['hud'];
  private readonly inventory:CarriedQuestProp['play']['inventory'];
  private readonly music:CarriedQuestProp['play']['music'];
  /** the round's numbers (carriedRound.ts: the Node simulation steps the same) */
  private readonly round:CarriedRound;
  private shown=0;
  constructor(private readonly ctx:ShardContext,input:unknown,files:ReadonlyMap<string,Uint8Array>=new Map()){
    const rows=parseCarriedQuest(input),runtime=ctx.game.runtime,world=runtime?.world,play=runtime?.play;
    this.entered=ctx.scope;this.construction=resourceScope();
    if(this.entered.disposed||this.entered.disposing||this.construction.disposed||this.construction.disposing
      ||runtime===undefined||world===undefined||world===null||play===undefined||play===null)throw new Error('Carried quest requires its live entered owners');
    this.rows=rows;this.runtime=runtime;this.world=world;this.player=world.player;this.registry=world.registry;this.play=play;
    this.quest=boundQuestState(this.entered,rows.quest);this.flags=this.quest.flags;this.hud=play.hud;this.music=play.music;this.inventory=play.inventory;
    this.round=carriedRound(rows);this.mount=rows.carrier?.kind==='player'?null:pageRidingMount(ctx);
    this.brain=ReturnProgram.page(rows.program,ctx.scope);
    const modelRow=rows.model[0];if(modelRow===undefined)throw new Error('Missing carried model');
    const model=defineSpecimenCatalogue<Record<string,object>>(rows.model,undefined,{},files).model(modelRow.key);
    const object=model.build(modelContext(world.sky),model.defaults,new Rng(0));
    if(!(object instanceof THREE.Object3D))throw new Error('Carried model requires its scene');
    this.object=object;this.object.name=rows.objectName;this.resetPose();
    let attached=true;
    const detach=():void=>{if(attached){attached=false;object.removeFromParent();}};
    this.entered.onDispose(detach);if(this.construction!==this.entered)this.construction.onDispose(detach);
  }
  private requireLive():void{
    if(this.entered.disposed||this.entered.disposing||this.construction.disposed||this.construction.disposing
      ||this.ctx.scope!==this.entered||this.ctx.game.runtime!==this.runtime||this.runtime.world!==this.world||this.runtime.play!==this.play
      ||this.world.player!==this.player||this.world.registry!==this.registry||this.play.hud!==this.hud||this.play.music!==this.music||this.play.inventory!==this.inventory
      ||boundQuestState(this.entered,this.rows.quest)!==this.quest||this.quest.flags!==this.flags
      ||(this.mount!==null&&pageRidingMount(this.ctx)!==this.mount))throw new Error('Carried quest owner changed or retired');
  }
  get goals():CarriedQuestRows['goals']{return this.rows.goals;}
  get carrying():boolean{return carriedRoundCarrying(this.rows,this.round);}
  private floorAt(x:number,z:number):number{
    const ground=terrainHeight(x,z),deck=this.world.registry.floorAt(x,z);
    return deck!==undefined&&deck>ground&&deck<ground+this.rows.floorWindow?deck:ground;
  }
  private resetPose():void{
    const {home,poses}=this.rows;carriedRoundHome(this.rows,this.round);this.object.position.set(home.x,this.floorAt(home.x,home.z)+poses.home.height,home.z);
    this.object.rotation.set(...poses.home.rotation);
  }
  private carryPose():void{
    const carrier=this.mount===null?this.player:this.mount.horse;if(carrier===null)return;
    const pose=this.rows.poses.attached;
    this.object.position.set(carrier.position.x+Math.cos(carrier.yaw)*pose.out,carrier.position.y+pose.height,carrier.position.z-Math.sin(carrier.yaw)*pose.out);
    this.object.rotation.set(0,carrier.yaw+pose.yaw,pose.roll);
  }
  /** The prop where the server has it for this player (`OWNED_ROW.prop`): 0 home, 1 carried, 2 + a goal. */
  show(line:number):void{
    this.requireLive();
    if(line===1){this.carryPose();this.shown=1;return;}
    if(line===this.shown)return;
    this.shown=line;
    const goal=this.rows.goals[line-2];
    if(goal===undefined){this.resetPose();return;}
    this.object.position.set(goal.x,this.floorAt(goal.x,goal.z)+this.rows.poses.delivered.height,goal.z);this.object.rotation.set(...this.rows.poses.delivered.rotation);
  }
  win():void{this.requireLive();this.project(this.rows.signals.win,0);}
  update(dt:number):void{
    this.requireLive();if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid carried quest delta');
    const elapsed=carriedRoundDue(this.rows,this.round,dt);
    if(elapsed!==null)this.project(this.rows.signals.step,elapsed);
    else if(this.carrying)this.carryPose();
  }
  private project(signal:string,dt:number):void{
    const {rows,world,mount,object}=this,carrier=mount===null?this.player:mount.horse,player=world.player.position;
    const fast=rows.carrier?.kind==='player'?Math.hypot(this.player.velocity.x,this.player.velocity.z)>=rows.carrier.minimumSpeed
      :mount?.gait==='canter'||mount?.gait==='gallop';
    const out=this.brain.project(signal,carriedRoundFrame(rows,this.round,dt,{playerX:player.x,playerZ:player.z,mounted:mount===null||mount.mounted,
      carrier:carrier!==null,fast,practice:practiceRoom.open,carrierX:carrier?.position.x??0,carrierZ:carrier?.position.z??0}));
    this.requireLive();
    const step=carriedRoundOutputs(rows,this.round,out);
    if(step.warning)commitQuestEffects(this.ctx,rows.quest,rows.warning);
    this.requireLive();
    if(step.reset)this.resetPose();
    else if(step.carry)this.carryPose();
    if(step.event>0){const action=rows.events.find(row=>row.value===step.event);if(action===undefined)throw new Error('Missing carried quest effect');commitQuestEffects(this.ctx,rows.quest,action.effects);}
    this.requireLive();
    const goal=carriedRoundGoal(rows,this.round,out);
    if(goal!==null){object.position.set(goal.x,this.floorAt(goal.x,goal.z)+rows.poses.delivered.height,goal.z);object.rotation.set(...rows.poses.delivered.rotation);}
  }
}
