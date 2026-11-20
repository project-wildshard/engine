import type { Vector3 } from 'three';
import type { TargetAnimal, TargetHit } from '@wildshard/engine/combat/types';
import type { SimHost } from '@wildshard/engine/sim';
import type { HeldArrowTargets, HeldRay } from './nativeHeld';

interface ArrowOwner {
  readonly key: string;
  readonly target: TargetAnimal;
  readonly ray: (from: Vector3, direction: Vector3, distance: number, hit: TargetHit | null) => TargetHit | null;
}
const contactOwners = new WeakMap<SimHost, HeldRay>();
const arrowOwners = new WeakMap<SimHost, ArrowOwner>();

function bind<T>(host: SimHost, owners: WeakMap<SimHost, T>, owner: T): void {
  if (owners.has(host) || host.scope.disposed || host.scope.disposing) throw new Error('Invalid held target owner');
  owners.set(host, owner);
  host.scope.onDispose(() => { owners.delete(host); });
}

/** A patrol's numeric joints participate in normal weapon contacts. */
export function bindHeldContacts(host: SimHost, ray: HeldRay): void {
  bind(host, contactOwners, ray);
}
export const heldContacts: HeldRay = (host, from, direction, distance, hit) =>
  contactOwners.get(host)?.(host, from, direction, distance, hit) ?? hit;

/** An arena lends its live weak point to arrows using its original save key. */
export function bindHeldArrowTarget(host: SimHost, owner: ArrowOwner): void {
  if (host.entities.has(owner.key)) throw new Error('Encounter arrow key would replace a population target');
  bind(host, arrowOwners, owner);
}
export const heldArrowTargets: HeldArrowTargets = {
  ray: (host, from, direction, distance, hit) => {
    const owner = arrowOwners.get(host);
    return owner === undefined ? hit : owner.ray(from, direction, distance, hit);
  },
  key: (host, target) => {
    const owner = arrowOwners.get(host);
    return owner?.target === target ? owner.key : null;
  },
  resolve: (host, id) => {
    const owner = arrowOwners.get(host);
    return owner?.key === id ? owner.target : null;
  },
};
