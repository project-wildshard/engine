import type { Targets } from '@wildshard/engine/combat/types';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { Scope } from '@wildshard/engine/app/scope';

export interface EquipmentActorOwner {readonly animals:RowBodiesView;readonly scope:Scope}
const owners=new WeakMap<Targets,EquipmentActorOwner>();
/** The native kit stage lends its actual actor manager by target-source identity.
 * Replacements carry the same target source; worlds never share a borrowed actor. */
export function bindEquipmentActors(targets:Targets,animals:RowBodiesView,scope:Scope):void{
  if(scope.disposed||scope.disposing||owners.has(targets))throw new Error('Equipment actors require one live owner');
  const owner={animals,scope};owners.set(targets,owner);scope.onDispose(()=>{if(owners.get(targets)===owner)owners.delete(targets);});
}
export function equipmentActorOwner(targets:Targets|undefined):EquipmentActorOwner{
  const owner=targets===undefined?undefined:owners.get(targets);if(owner===undefined||owner.scope.disposed||owner.scope.disposing)throw new Error('Equipment target source has no native actor owner');return owner;
}
