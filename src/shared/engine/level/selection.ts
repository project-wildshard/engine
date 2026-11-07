import type { GrassDriver } from '../../../client/engine/render/look';
import type { LevelSpec } from './spec';

/**
 * The parts of a level's resolved look that its own content builds from while its frame is bound (SF63): today the
 * grass driver (`LookStrategy.grass`). A frame-bound region uses its own level's parts, never the page look's.
 */
export interface LevelLookParts { readonly grass?: GrassDriver }

let selected: LevelSpec | null = null;
const frames: { level: LevelSpec; look: LevelLookParts | null }[] = [];
const listeners = new Set<(level: LevelSpec) => void>();

/** The composition root supplies engine data before constructing the renderer or world. */
export function configureLevel(level: LevelSpec): void {
  selected = level;
  for (const listener of listeners) listener(level);
}

/** Early error reporting and the renderer-free page can inspect selection without requiring a world. */
export function selectedLevel(): LevelSpec | null { return frames.at(-1)?.level ?? selected; }

export function activeLevel(): LevelSpec {
  const level = selectedLevel();
  if (level === null) throw new Error('No level has been configured');
  return level;
}

/**
 * The look parts of the bound frame's level: undefined when no frame is bound (the page's own look applies), null when
 * the bound level has no look (the engine defaults apply, not the page look's).
 */
export function boundLevelLook(): LevelLookParts | null | undefined { const frame = frames.at(-1); return frame === undefined ? undefined : frame.look; }

/** Frame-local selection without changing the configured page or notifying page-load listeners. */
export function bindLevelSelection(level: LevelSpec, look: LevelLookParts | null = null): () => void {
  const entry = { level, look }; frames.push(entry);
  return () => { const index = frames.indexOf(entry); if (index !== -1) frames.splice(index, 1); };
}

export function onLevelChange(listener: (level: LevelSpec) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
