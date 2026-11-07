import type { FloorGridPlan, FloorGridState } from './frame-floor-grid.mjs';

export interface PublicGridWitness {
  cellScreens?: {instance:string;status:string;issue:string|null}[];
  developer: boolean; savedDeveloper: unknown; state: FloorGridState;
  refusals: Record<string,string>; homeResidency: {instance:string;bytes:number}|undefined; runtimeLevel: string;
}
export function publicGridIntentCode(home: {instance:string;slug:string}): string;
export function publicGridPlans(state: Pick<FloorGridState,'home'|'cells'|'pitch'>): FloorGridPlan[];
export function readPublicGridWitness(): PublicGridWitness;
export function publicGridWitnessFailures(witness: PublicGridWitness, requireTemplate: boolean): string[];
