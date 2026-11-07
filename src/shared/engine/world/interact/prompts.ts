import type { Physics } from '../../physics/Physics';
import { castSegment, lineOfSight } from '../../physics/query';

/** A prompt's world point, independent of its view or input binding. */
export interface PromptPoint { readonly x: number; readonly y: number; readonly z: number }
/** Live reach and weak priority can be getters: hidden prompts have zero reach. */
export interface PromptTarget { readonly position: PromptPoint; readonly radius: number; readonly weak?: boolean; readonly sight?: PromptSight }
/** The target's own native owner may be a registered piece or a trusted reconstructed identity. */
export interface PromptSight { readonly slack: number; readonly body?: unknown }
/** Unspecified targets may meet their own surface within this many metres of the prompt. */
export const PROMPT_SIGHT_SLACK = 0.5;
const sights = new WeakMap<PromptTarget, PromptSight>();
/** The one `sight` getter every prompt shares. V8 keeps a defined accessor in the shared hidden-class transition tree, so a
 *  per-prompt closure there outlived its prompt and kept a retired region's door, its building owner and that visit's world
 *  alive (live P0); this function captures nothing. */
function sightOf(this: PromptTarget): PromptSight | undefined { return sights.get(this); }

/** Attach actual native owner identity without retaining a retired prompt. */
export function setPromptSight(target: PromptTarget, sight: PromptSight): void {
  sights.set(target, sight);
  // Trusted native captures read the association from the actual prompt, rather than infer an owner from geometry.
  if (!Object.hasOwn(target, 'sight')) Object.defineProperty(target, 'sight', { get: sightOf });
}

/** A clear native segment, or its first hit is the target itself. A missing boot world retains distance-only picking. */
export function promptVisible(physics: Physics | null, eye: PromptPoint, target: PromptTarget): boolean {
  if (physics === null) return true;
  const sight = sights.get(target);
  if (lineOfSight(physics, eye, target.position, sight?.slack ?? PROMPT_SIGHT_SLACK)) return true;
  const body = sight?.body;
  return body !== undefined && body !== null && castSegment(physics, eye, target.position)?.owner === body;
}

/** Page pick law: strict reach, first equal-distance row, and any visible strong prompt ahead of weak prompts. */
export function pickPrompt<T extends PromptTarget>(list: readonly T[], eye: PromptPoint, physics: Physics | null): T | undefined {
  let best = Infinity, pick: T | undefined, weakBest = Infinity, weak: T | undefined;
  for (const target of list) {
    const dx = target.position.x - eye.x, dy = target.position.y - eye.y, dz = target.position.z - eye.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (target.weak === true) {
      if (distance < target.radius && distance < weakBest && promptVisible(physics, eye, target)) { weakBest = distance; weak = target; }
      continue;
    }
    if (distance < target.radius && distance < best && promptVisible(physics, eye, target)) { best = distance; pick = target; }
  }
  return pick ?? weak;
}
