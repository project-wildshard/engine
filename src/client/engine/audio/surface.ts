import { audioMixValue } from '../../../shared/engine/audio/audioProfiles';
import type { AudioSurfaceRecipe } from '@wildshard/format/audioProfiles';
/**
 * What a footstep lands on. `GroundSurface`: the built ground a level's step map classifies (decks, a stone dais, the sand,
 * wet sand at the swash line, grass, rock, the shallows); collider materials extend it (src/shared/engine/physics/surface.ts).
 * `StepSurface`: every surface the mixer's steps know (`audio.footstep`, `footstep-<surface>` samples, a level's
 * `player.stepSurface` answer): the ground ones plus 'litter' (forest floor, the mixer's default), mud (a pond's edge),
 * wet (rain), gravel (roads) and metal.
 */
/** Ordered terrain/deck surface vocabulary; ambience appends its weather and material surfaces. */
export const GROUND_SURFACES = ['sand', 'wetSand', 'grass', 'rock', 'planks', 'stone', 'water'] as const;
export type GroundSurface = typeof GROUND_SURFACES[number];
export type StepSurface = GroundSurface | 'litter' | 'gravel' | 'mud' | 'wet' | 'metal';

/** The unanswered request retains the caller's default surface. */
export interface StepSurfaceRequest { x: number; y: number; z: number; surface: StepSurface }
declare module '../events/maps' {
  interface AskMap {
    'player.stepSurface': readonly [StepSurfaceRequest, StepSurfaceRequest];
  }
}

/** The original compiled floor query; borrowing it neither creates nor owns a site. */
export type AudioFloorQuery = (x:number,z:number)=>number|undefined;
/** Native floor and point loans, read only when their ordered rule is reached. */
export interface AudioSurfacePorts {
  heightAt:(x:number,z:number)=>number;
  sea?:number;
  floors:Readonly<Record<string,readonly (AudioFloorQuery|{floorHeightAt:AudioFloorQuery}|null|undefined)[]>>;
  values?:Readonly<Record<string,(x:number,z:number)=>number>>;
  circles?:Readonly<Record<string,()=>{x:number;z:number;r:number}|undefined>>;
}
/** One declared surface law for terrain, enclosed floors and weather overrides. */
export class AudioSurfaceMap<T extends string> {
  private readonly names:ReadonlyMap<string,T>;
  private readonly recipe:AudioSurfaceRecipe;
  private readonly ports:AudioSurfacePorts;
  constructor(recipe:AudioSurfaceRecipe,names:readonly T[],ports:AudioSurfacePorts) {
    this.recipe=recipe;this.ports=ports;
    this.names=new Map(names.map(name=>[name,name]));
    this.name(recipe.fallback);
    for(const rule of recipe.rules){
      this.name(rule.surface);
      if(rule.kind==='floor'&&ports.floors[rule.source]===undefined)throw new Error('Missing audio floor probe');
      if(rule.kind==='circle'&&ports.circles?.[rule.source]===undefined)throw new Error('Missing audio circle probe');
      if(rule.kind==='value'&&rule.source!=='height'&&rule.source!=='slope'&&ports.values?.[rule.source]===undefined)throw new Error('Missing audio value probe');
    }
  }
  private name(id:string):T {const name=this.names.get(id);if(name===undefined)throw new Error('Unknown audio surface');return name;}
  surfaceAt(x:number,z:number,y:number):T {
    let height:number|undefined,slope:number|undefined;
    const read=(id:string):number=>{const probe=this.ports.values?.[id];if(probe===undefined)throw new Error('Missing audio value probe');return probe(x,z);};
    for(const rule of this.recipe.rules){
      let hit=false;
      if(rule.kind==='floor'){
        for(const floor of this.ports.floors[rule.source]??[]){const level=typeof floor==='function'?floor(x,z):floor?.floorHeightAt(x,z);if(level!==undefined&&Math.abs(y-level)<rule.tolerance){hit=true;break;}}
      }else if(rule.kind==='circle'){
        const circle=this.ports.circles?.[rule.source]?.();hit=circle!==undefined&&Math.hypot(x-circle.x,z-circle.z)<circle.r+rule.padding;
      }else{
        let value:number;
        if(rule.source==='height'){height??=this.ports.heightAt(x,z)-(this.ports.sea??0);value=height;}
        else if(rule.source==='slope'){
          if(slope===undefined){const H=this.ports.heightAt,dx=(H(x+1,z)-H(x-1,z))/2,dz=(H(x,z+1)-H(x,z-1))/2;slope=1-1/Math.sqrt(1+dx*dx+dz*dz);}value=slope;
        }else{const probe=this.ports.values?.[rule.source];if(probe===undefined)throw new Error('Missing audio value probe');value=probe(x,z);}
        hit=(rule.op==='lt'?value<rule.threshold:value>rule.threshold)&&(rule.when===undefined||audioMixValue(rule.when,read)!==0);
      }
      if(hit)return this.name(rule.surface);
    }
    return this.name(this.recipe.fallback);
  }
}
