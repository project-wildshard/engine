// Frozen ee0aa4fe29 native orchestration and charged-bow oracle.
// Only import paths change; production never imports this fixture.
import * as THREE from 'three';
import type { BowVariantRows } from '@wildshard/format/bowVariantRows';
import { equipmentActorOwner } from '../../src/client/game/loadout/actors';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';
import { ProjectedTrail } from '@wildshard/engine/combat/view/projectedTrail';
import { parse } from 'valibot';
import type { ShardContext } from '../../src/client/game/plugin/context';
import type { Scope } from '@wildshard/engine/app/scope';
import { HeldFirearm, type HeldFirearmProfile, type HeldFirearmView, type HeldFirearmRows } from '../../src/client/game/plugin/heldFirearm';
import { FirearmWeaponProfileSchema } from '@wildshard/format/weaponProfiles';
import { bindRuntimeEquipment } from '../../src/client/game/plugin/headless';
import { MountedLoadoutSchema, type MountedLoadoutRows } from '@wildshard/format/loadout';
import { macrotask } from '@wildshard/engine/boot/plan';
import { BladeSet } from '../../src/client/game/weapons/mountedBlade';
import { PolearmSet, type HeldPolearmWorld } from '../../src/client/game/weapons/heldPolearm';
import { Bow } from '../../src/client/game/weapons/Bow';
import { loadHeldBow } from './originalHeldBowLoader';
import { ItemCatalogue } from '../../src/shared/game/loadout/itemCatalogue';
import type { ArcWeaponPower } from '../../src/client/game/weapons/arcPower';
import type { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import type { Targets, TargetAnimal } from '@wildshard/engine/combat/types';
import type { Weapon } from '@wildshard/engine/combat/Weapon';

type Blade = InstanceType<BladeSet['Weapon']>;
type Polearm = InstanceType<PolearmSet['Weapon']>;
export interface MountedLoadout {
  base:Blade;bow:Bow;sabre:Blade;spear:Polearm;extras:Weapon[];
  install:(weapons:EquipmentService)=>void;
  upgradeBow:(weapons:EquipmentService,power:VariantBowPower)=>void;
  upgradeSabre:(weapons:EquipmentService,power:ArcWeaponPower)=>void;
  refill:()=>void;
  setMount:(state:Blade['mount'])=>void;
}

/** Capture the original construction loans; no lookup may follow a replacement
 * across a native constructor yield or a product read. */
function constructionOwner(ctx:ShardContext|undefined,world:HeldPolearmWorld):()=>void {
  if(ctx===undefined)return ()=>undefined;
  const scope=ctx.scope,product=ctx.product,source=product.shardfile,items=source.items;
  const game=ctx.game,runtime=game.runtime,app=ctx.app,equipment=app.equipment;
  return ()=>{
    if(scope.disposed||scope.disposing)throw new Error('Mounted construction owner has ended');
    if(ctx.scope!==scope||ctx.product!==product||product.shardfile!==source||source.items!==items
      ||ctx.game!==game||game.runtime!==runtime||runtime?.world!==world
      ||ctx.app!==app||app.equipment!==equipment)throw new Error('Mounted construction owner was replaced');
  };
}

/** Client-only kit assembly over the native families. No content constructor,
 * selection hook or replacement callback crosses the declaration boundary. */
export class MountedArsenal {
  readonly blade:BladeSet;
  readonly polearm:PolearmSet;
  readonly rows:MountedLoadoutRows;
  private readonly pageKits=new WeakMap<Scope,MountedLoadout|null>();
  constructor(input:unknown){
    this.rows=parse(MountedLoadoutSchema,input);
    this.blade=new BladeSet(this.rows.blade);this.polearm=new PolearmSet(this.rows.polearm);
  }
  /** Install the staged equipment builder from admitted native family rows.
   * Context is the game's concrete page authority; no content callback enters. */
  installPage(ctx:ShardContext):void{
    const runtime=ctx.game.runtime,page=this.rows.page;
    if(ctx.scope.disposed||ctx.scope.disposing||runtime===undefined||page===undefined)throw new Error('Mounted page needs its live native equipment declaration');
    const world=runtime.world;if(world===null)throw new Error('Mounted page needs its actual world');
    if(this.pageKits.has(ctx.scope))throw new Error('Mounted page is already installed');
    const scope=ctx.scope,check=constructionOwner(ctx,world),product=ctx.product;check();
    const catalogue=new ItemCatalogue(product.shardfile.items);
    ctx.rows.weapon([this.rows.bow.item,this.rows.blade.item,this.rows.polearm.item,page.firearm.item].map(id=>catalogue.equipment(id)));
    this.pageKits.set(scope,null);
    scope.onDispose(()=>{this.pageKits.delete(scope);});
    runtime.buildEquipment=async(targets,allowUnlocked)=>{
      check();
      const kit=await this.build(world,targets,allowUnlocked,product.shardfile.items,ctx);check();
      await macrotask();check();
      const data=await product.json<{feel:Pick<HeldFirearmProfile,'ads'>;view:HeldFirearmView;rows:HeldFirearmRows}>(page.firearm.file);check();
      const item=ctx.product.shardfile.items.rows.find(row=>row.id===page.firearm.item);
      const profile={...parse(FirearmWeaponProfileSchema,item?.kind==='weapon'?item.profile:undefined),...data.feel};
      const rifle=new HeldFirearm(world,targets,{row:catalogue.equipment(page.firearm.item),allowUnlocked,muzzleLight:page.firearm.muzzleLight,
        profile,view:data.view,rows:data.rows,model:{}});
      check();
      bindRuntimeEquipment(ctx,ctx.product.shardfile,[kit.bow,kit.sabre,kit.spear,rifle].map(weapon=>{
        const source=ctx.product.shardfile.items.rows.find(row=>row.id===weapon.row.id);return {id:weapon.row.id,weapon,profile:source?.kind==='weapon'?source.profile:undefined};
      }));
      check();this.pageKits.set(scope,kit);
      return {primary:kit.base,rifle,secondary:null,extras:kit.extras,order:page.order,install:kit.install};
    };
  }
  /** Borrow the exact native kit assembled between kit and play. */
  pageKit(ctx:Pick<ShardContext,'scope'>):MountedLoadout|null{return ctx.scope.disposed||ctx.scope.disposing?null:this.pageKits.get(ctx.scope)??null;}
  async build(world:HeldPolearmWorld,targets:Targets,allowUnlocked:boolean,items:unknown,context?:ShardContext):Promise<MountedLoadout>{
    const check=constructionOwner(context,world);check();
    const sabre=new this.blade.Weapon(world,targets,{allowUnlocked});await macrotask();check();
    const spear=new this.polearm.Weapon(world,targets,{allowUnlocked});await macrotask();check();
    const {profile}=await loadHeldBow(this.rows.bow.file);check();
    const bow=new Bow(world,targets,{row:new ItemCatalogue(items).equipment(this.rows.bow.item),profile,allowUnlocked});
    const kit:MountedLoadout={
      base:sabre,bow,sabre,spear,extras:[bow,spear],
      install:weapons=>{for(const weapon of kit.extras)weapons.unlock(weapon.id);weapons.select(({blade:kit.sabre,polearm:kit.spear,bow:kit.bow})[this.rows.initial].id,true);},
      upgradeBow:(weapons,power)=>{
        const variant=this.rows.variants.bow,previous=kit.bow;if(previous.row.id===variant.id)return;
        const next=new Bow(world,targets,{row:{...previous.row,id:variant.id,ui:{...previous.row.ui,name:variant.name,swapName:variant.name},meta:{...previous.meta,name:variant.name}},profile,allowUnlocked});
        next.damageMultiplier=previous.damageMultiplier;next.onLoose=previous.onLoose;next.carryMountState(previous);
        weapons.replace(previous.id,next);kit.bow=next;power.apply(next);
      },
      upgradeSabre:(weapons,power)=>{
        const variant=this.rows.variants.blade;if(kit.sabre.row.id===variant.id)return;
        const base=this.blade.profile(),next=new this.blade.Weapon(world,targets,{allowUnlocked,power,profile:{...base,id:variant.id,parent:base.id,ui:{...base.ui,name:variant.name},meta:{...base.meta,name:variant.name}}});
        next.carryPassState(kit.sabre);weapons.replace(kit.sabre.id,next);kit.sabre=next;kit.base=next;
      },
      refill:()=>{spear.javelins=spear.maxJavelins;kit.bow.addBolts(kit.bow.magazine);},
      setMount:state=>{kit.sabre.mount=state;spear.mount=state;kit.bow.setMount(state);},
    };
    return kit;
  }
}

/** Client-only held variant. The existing bow and its native actor owner keep
 * their identities; charged activation and contact numbers come from the guest. */
export class VariantBowPower {
  private bow:Bow|null=null;
  private brain:ReturnProgram|null=null;
  private readonly trail:ProjectedTrail;
  private readonly pending:{t:number;target:TargetAnimal;point:THREE.Vector3;dir:THREE.Vector3;base:number}[]=[];
  private sunShot=false;
  private readonly origin=new THREE.Vector3();private readonly direction=new THREE.Vector3();private readonly velocity=new THREE.Vector3();private readonly at=new THREE.Vector3();private readonly segment=new THREE.Vector3();
  constructor(scene:THREE.Scene,private readonly camera:THREE.Camera,private readonly rows:BowVariantRows){
    if(this.rows.trail.points>48)throw new Error('Bow prediction exceeds its native contact bound');
    this.trail=new ProjectedTrail(scene,camera,this.rows.trail);
  }
  get applied():boolean{return this.bow!==null;}
  apply(bow:Bow):void{
    const {rows}=this,owner=equipmentActorOwner(bow.targetSource);this.brain??=ReturnProgram.page(rows.program,owner.scope);
    bow.row={...bow.row,id:rows.id,meta:{...bow.meta,name:rows.name}};if(this.bow===bow)return;
    this.bow=bow;bow.setStyle(rows.style);bow.drawSpeedScale*=rows.drawSpeed;bow.onLoose=power=>{this.loosed(power);};
    const previous=bow.damageMultiplier;
    bow.damageMultiplier=hit=>{
      const scales=Object.hasOwn(rows.damageScale.kinds,hit.animal.kind)?rows.damageScale.kinds[hit.animal.kind]:undefined;
      return (previous?.(hit)??1)*(scales??rows.damageScale.base)[this.sunShot?1:0];
    };
  }
  private decide(power:number,base=0,crush=false):Readonly<Record<string,number>>{
    const rows=this.rows;if(this.brain===null)throw new Error('Variant has no applied native owner');return this.brain.project(rows.signal,{bowPower:power,bowThreshold:rows.threshold,bowBaseDamage:base,bowPierce:rows.pierce,bowCrush:Number(crush),bowCrushScale:rows.crush});
  }
  private loosed(power:number):void{
    const bow=this.bow;this.sunShot=this.decide(power)['bowSun']===1;if(bow===null||!this.sunShot)return;
    const {flight}=this.rows,animals=equipmentActorOwner(bow.targetSource).animals,o=this.origin,d=this.direction,v=this.velocity,a=this.at,b=this.segment;
    this.camera.getWorldDirection(d);o.setFromMatrixPosition(this.camera.matrixWorld).addScaledVector(d,flight.offset);v.copy(d).multiplyScalar(flight.base+flight.draw*power).add(bow.carrierVelocity);
    const n=bow.arrows.predict(o,v,this.trail.points,this.rows.trail.points,flight.step,flight.from);this.trail.show(n);
    let first:TargetAnimal|null=null,travelled=0,ax=o.x,ay=o.y,az=o.z;
    for(let i=0;i<48;i++){
      if(i>=n)break;const bx=this.trail.points[i*3]??ax,by=this.trail.points[i*3+1]??ay,bz=this.trail.points[i*3+2]??az;
      a.set(ax,ay,az);b.set(bx-ax,by-ay,bz-az);const length=b.length();
      if(length>1e-3){b.multiplyScalar(1/length);let from=0;
        for(let guard=0;guard<3;guard++){
          const hit=animals.raycast(a.set(ax,ay,az).addScaledVector(b,from),b,length-from);if(hit===null)break;
          if(first===null){first=hit.animal;from+=hit.distance+flight.gap;continue;}
          if(hit.animal!==first&&hit.animal.alive){this.pending.push({t:(travelled+from+hit.distance)/(flight.base+flight.draw*power),target:hit.animal,point:hit.point.clone(),dir:b.clone(),base:hit.damage});return;}
          from+=hit.distance+flight.gap;
        }
      }
      travelled+=length;ax=bx;ay=by;az=bz;
    }
  }
  update(dt:number):void{
    this.trail.advance(dt);
    for(let i=this.pending.length-1;i>=0;i--){const hit=this.pending[i];if(hit===undefined)continue;hit.t-=dt;if(hit.t>0)continue;this.pending.splice(i,1);
      if(!hit.target.alive)continue;const result=this.decide(0,hit.base,this.rows.crushKinds.includes(hit.target.kind)),damage=result['bowDamage'];if(damage===undefined)throw new Error('Missing variant contact number');hit.target.applyDamage(damage,hit.point,hit.dir);
    }
  }
}
