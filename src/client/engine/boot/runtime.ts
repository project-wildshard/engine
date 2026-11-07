import { loadModuleWithProgress } from '../ui/loadProgress';
import type * as ExploreModule from '../explore/Explore';
import type * as FeedbackModule from '../ui/Feedback';
import type * as PracticeModule from '../practice/TrainingArena';
import type { loadPlayground as PlaygroundLoader } from '../practice/playground/load';
/** Optional UI code loads on its first request, with owned preparation progress. */

export function loadExplore(): Promise<typeof ExploreModule> { return loadModuleWithProgress('Explore', () => import('../explore/Explore')); }
export function loadFeedback(): Promise<typeof FeedbackModule> { return loadModuleWithProgress('Feedback', () => import('../ui/Feedback')); }


/** Practice code is requested only by a practice entry, never ordinary world preparation. */
export function loadPractice(): Promise<typeof PracticeModule> { return loadModuleWithProgress('Practice', () => import('../practice/TrainingArena')); }

/** Keep the scene loader and its cache out of ordinary entry, with progress through its actual preparation. */
export function loadPlayground(...args: Parameters<typeof PlaygroundLoader>): ReturnType<typeof PlaygroundLoader> {
  return loadModuleWithProgress('Playground', async () => {
    const module = await import('../practice/playground/load');
    return module.loadPlayground(...args);
  });
}
