import type { ClipName } from '@wildshard/engine/anim/rig';
import { STARTER_ARM_CLIPS } from './clips.generated';
/** Metadata-only renames shared by the two authored arm rigs. Source track names stay byte-identical. */
export const ARM_CLIPS: Readonly<Partial<Record<ClipName, string>>> = STARTER_ARM_CLIPS.arm;
/** Shared swimming track aliases; authored source names are preserved. */
export const SWIM_CLIPS: Readonly<Partial<Record<ClipName, string>>> = STARTER_ARM_CLIPS.swim;
/** List declared logical clips in their authored alias order. */
export const armClipNames = (aliases: Readonly<Partial<Record<ClipName, string>>>): ClipName[] => Object.keys(aliases) as ClipName[];
