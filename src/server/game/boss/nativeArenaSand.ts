import * as v from 'valibot';
import type {SimHost} from '@wildshard/engine/sim';
import {HeightPatch} from '@wildshard/engine/physics/heightPatch';
import {tagOf,untagCollider} from '@wildshard/engine/physics/surface';
import {toColumnMajor} from '@wildshard/engine/physics/terrain';
import {groups} from '@wildshard/engine/physics/groups';
import {ArenaRoomGround,type SandRow} from '../../../shared/game/boss/arenaGround';

const finite:v.GenericSchema<number>=v.pipe(v.number(),v.finite());
/** The sand's continuation: its recipe, its ground and the grid and collider last published. */
interface SandSaved {
  version:1;recipe:string;ground:{sand:number[];dirty:boolean;clock:number};grid:number[]|null;collider:number|null;
}
const Saved:v.GenericSchema<SandSaved>=v.strictObject({version:v.literal(1),recipe:v.pipe(v.string(),v.maxLength(100_000)),
  ground:v.strictObject({sand:v.pipe(v.array(finite),v.maxLength(256*256)),dirty:v.boolean(),clock:finite}),
  grid:v.nullable(v.pipe(v.array(finite),v.maxLength(257*257))),collider:v.nullable(v.pipe(finite,v.minValue(0)))});

/** The original room's published vertex means. Float32 storage is the page
 * height mesh/HeightPatch storage, in the original j/i/di/dj order. */
export function arenaSandVertices(ground:ArenaRoomGround,cells:number):Float32Array {
  const size=cells+1,grid=new Float32Array(size*size);
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
    let sum=0,count=0;
    for(const [di,dj]of [[-1,-1],[0,-1],[-1,0],[0,0]] as const){
      const x=i+di,z=j+dj;
      if(x>=0&&z>=0&&x<cells&&z<cells){sum+=ground.sand[z*cells+x]??0;count++;}
    }
    grid[j*size+i]=count>0?sum/count:0;
  }
  return grid;
}

/** Reuse the actual numeric room and HeightPatch. Quiet restore borrows the
 * already-restored collider; the next real publication clears that collider
 * once and calls HeightPatch.set, in its original remove/create order. */
export class NativeArenaSand {
  readonly ground:ArenaRoomGround;
  private patch:HeightPatch|undefined;
  private grid:Float32Array|null=null;
  private retained:number|null=null;
  private readonly options:{x:number;y:number;z:number;size:number;res:number;material:'sand';owner:string};
  private readonly recipe:string;
  /** The drifts as a client reads them, as last published. */
  wire:readonly SandRow[]=[];
  constructor(private readonly host:SimHost,private readonly rows:ConstructorParameters<typeof ArenaRoomGround>[0],private readonly id:string,private readonly wireName:string){
    if(id.length===0||rows.sandCells>256)throw new Error('Missing bounded room sand owner');
    this.ground=new ArenaRoomGround(rows);
    this.options={x:rows.origin.x,y:rows.origin.y,z:rows.origin.z,size:rows.halfWidth*2,res:rows.sandCells+1,material:'sand' as const,owner:id};
    this.recipe=JSON.stringify({rows,id},(_key,value:unknown):unknown=>typeof value==='number'&&Object.is(value,-0)?{'sand.number':'-0'}:value);
  }
  private live():void {if(this.host.scope.disposed||this.host.scope.disposing)throw new Error('Room sand owner retired');}
  private collider():number|null {
    this.live();const handles:number[]=[];
    this.host.physics.world.forEachCollider(collider=>{if(tagOf(collider)?.owner===this.id)handles.push(collider.handle);});
    if(handles.length>1)throw new Error('Room sand ownership is not unique');
    const handle=handles[0]??null,active=this.grid?.some(value=>value>.01)===true;
    if(active!==(handle!==null))throw new Error('Room sand publication and physical owner differ');
    if(handle===null)return null;
    const collider=this.host.physics.world.getCollider(handle),grid=this.grid;
    if(collider===null||grid===null||collider.shapeType()!==this.host.physics.R.ShapeType.HeightField)throw new Error('Missing original room heightfield');
    const at=collider.translation(),scale=collider.heightfieldScale(),rotation=collider.rotation(),heights=collider.heightfieldHeights(),expected=toColumnMajor(grid,this.options.res);
    if(scale===null||tagOf(collider)?.material!=='sand'||collider.parent()!==null||!collider.isEnabled()
      ||collider.collisionGroups()!==groups('WORLD')||collider.heightfieldNRows()!==this.options.res-1||collider.heightfieldNCols()!==this.options.res-1
      ||![at.x,at.y,at.z].every((value,index)=>Object.is(value,Math.fround([this.options.x,this.options.y,this.options.z][index]??Number.NaN)))
      ||![scale.x,scale.y,scale.z].every((value,index)=>Object.is(value,Math.fround([this.options.size,1,this.options.size][index]??Number.NaN)))
      ||![rotation.x,rotation.y,rotation.z,rotation.w].every((value,index)=>Object.is(value,[0,0,0,1][index]))
      ||heights.length!==expected.length||heights.some((value,index)=>!Object.is(value,expected[index])))throw new Error('Room sand collider lost its original geometry');
    return handle;
  }
  advance(dt:number):void {
    this.live();if(!this.ground.pace(dt))return;
    this.wire=this.ground.sandRows(this.wireName);
    if(this.retained!==null){
      if(this.collider()!==this.retained)throw new Error('Restored room sand owner was replaced');
      const collider=this.host.physics.world.getCollider(this.retained);if(collider===null)throw new Error('Missing restored sand collider');
      untagCollider(collider);this.host.physics.world.removeCollider(collider,false);this.retained=null;
    }
    this.patch??=new HeightPatch(this.host.physics,this.options);
    this.grid=arenaSandVertices(this.ground,this.rows.sandCells);this.patch.set(this.grid);
  }
  snapshot():SandSaved {const ground=this.ground.snapshot();return {version:1,recipe:this.recipe,ground:{...ground,sand:[...ground.sand]},grid:this.grid===null?null:Array.from(this.grid),collider:this.collider()};}
  restore(input:unknown):void {
    this.live();const saved=v.parse(Saved,input),count=this.options.res*this.options.res;
    if(saved.recipe!==this.recipe||saved.ground.sand.some(value=>!Object.is(value,Math.fround(value)))
      ||saved.grid!==null&&(saved.grid.length!==count||saved.grid.some(value=>!Object.is(value,Math.fround(value))))
      ||(saved.grid?.some(value=>value>.01)===true)!==(saved.collider!==null))throw new Error('Invalid published room sand continuation');
    this.ground.restore(saved.ground);this.grid=saved.grid===null?null:Float32Array.from(saved.grid);
    this.retained=saved.collider;this.patch=undefined;
  }
  /** What a restored ground says on the wire. */
  republish():void {this.wire=this.ground.sandRows(this.wireName);}
  physicsRestored():void {if(this.collider()!==this.retained)throw new Error('Restored room sand handle differs');}
}
