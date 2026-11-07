/**
 * The page's one AudioContext and the first-gesture gate that makes it (G325, SF67).
 *
 *   installAudioUnlock(scope)     // once per page, before the boot (src/client/app/pageServices.ts)
 *   audioUnlocked()               // the first gesture has happened (or no gate is installed)
 *   whenAudioUnlocked(fn)         // run fn in that gesture (at once when it already has); .cancel()
 *   pageAudioContext()            // the context, if one exists yet
 *   claimPageAudioContext()       // the context, made now when none exists (Audio's graph, after the gate)
 *
 * Kept apart from Audio.ts so the page entry installs the gate without loading the mixer.
 */
import { currentOwner, withOwner } from '../../../shared/engine/app/ownership';
import type { Scope } from '../../../shared/engine/app/scope';
import {pagePresentation} from '../app/view/presentation';
import {AudioActivity} from './activity';

/** the page's one AudioContext (E155: every resident shard's Audio builds its graph on it) */
let sharedCtx: AudioContext | undefined;
let activity:AudioActivity|undefined;

/** a new AudioContext (the constructor is a ~130 ms native task at 4× CPU), or undefined without WebAudio */
function newContext(): AudioContext | undefined {
  const w: { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext } = window; // old Safari: prefixed only
  const AC = w.AudioContext ?? w.webkitAudioContext;
  return AC === undefined ? undefined : new AC({ latencyHint: 'interactive' });
}

/** The first-gesture gate (G325): `off` without `installAudioUnlock` (old behaviour), `waiting` until the first gesture, then `open`. */
let gate: 'off' | 'waiting' | 'open' = 'off';
/** audio work asked for before the first gesture (a queued `resume()`, a queued `Music.play`), run in order once it lands */
const onUnlock = new Set<() => void>();

/** The gesture's work: everything that queued for it, in order (a queued `resume()` makes the page's context here). */
function unlock(): void {
  if (gate === 'open') return;
  gate = 'open';
  const queued = [...onUnlock]; onUnlock.clear();
  for (const run of queued) {
    try { run(); } catch (error) { console.error('[audio] a start queued for the first gesture failed', error); }
  }
}

/** Events that count as the player's first gesture: iOS unlocks a context resumed in touchend / click / keydown, Chrome in pointerdown too. */
const GESTURES = ['pointerdown', 'touchend', 'mousedown', 'click', 'keydown'] as const;

/**
 * G325 (Jake, SF67): the page's AudioContext is made in the player's first gesture (pointerdown / touchend / mousedown /
 * click / keydown, whichever comes first), never during load — its ~130 ms constructor leaves the boot. Until that gesture
 * `Audio.resume()` and `Music.play()` queue; capture listeners on the window run them, in order, inside it, before any game
 * handler of the same event, and the queued resume builds the context there. Every other sound checks `audio.ready` and
 * stays silent until then. A page with no audio queued (the cold title) makes no context at all; its game's own gesture
 * handlers (ENTER WORLD, the title's first tap) make it later, as before. Each gesture resumes the context until it runs
 * (iOS starts one made in pointerdown suspended), then the listeners go. The sample decode is unaffected: it runs on its own
 * OfflineAudioContext (preload.ts). Call once per page, before the boot (src/client/app/pageServices.ts); a page that never calls it
 * builds the context on first use, as before. Returns the uninstall.
 */
export function installAudioUnlock(scope: Scope, target: EventTarget = window): () => void {
  if (gate !== 'off') return () => undefined;
  gate = 'waiting';
  activity=new AudioActivity(scope,pagePresentation);activity.attach(sharedCtx);
  // Retained after first unlock: Safari can require another gesture after showing a page.
  const retry=():void=>{if(sharedCtx!==undefined)activity?.resume();};
  for(const type of GESTURES)scope.listen(target,type,retry,{capture:true,passive:true});
  const own = scope.child('audio.unlock');
  const remove = (): void => { own.dispose(); };
  const onGesture = (): void => {
    unlock();
    const ctx = sharedCtx;
    if (ctx === undefined) return; // nothing wanted audio yet: a later gesture resumes the context once something makes it
    if (ctx.state === 'running') { remove(); return; }
    resumePageAudioContext(ctx); // the activity owner retries a refused resume on the next gesture
  };
  for (const type of GESTURES) own.listen(target, type, onGesture, { capture: true, passive: true });
  return remove;
}

/** The player's first gesture has happened (or no gate is installed): audio may build its graph now. */
export function audioUnlocked(): boolean { return gate !== 'waiting'; }

/** Run `fn` once the first gesture lands (at once when it already has); `cancel()` drops it if it has not run. */
export function whenAudioUnlocked(fn: () => void): { cancel: () => void } {
  if (audioUnlocked()) { fn(); return { cancel: () => undefined }; }
  const owner = currentOwner(), run = (): void => { withOwner(owner, fn); }; // runs under the owner that asked (a level's scope)
  onUnlock.add(run);
  return { cancel: () => { onUnlock.delete(run); } };
}



/** The page's context, made now when none exists (Audio's graph: after the gate, or with no gate installed); undefined without WebAudio. */
export function claimPageAudioContext(): AudioContext | undefined {
  sharedCtx ??= newContext();
  activity?.attach(sharedCtx);
  return sharedCtx;
}

/** A closed context leaves the page (an Audio disposed for good): the next claim makes a new one. */
export function releasePageAudioContext(ctx: AudioContext): void { if (sharedCtx === ctx) {sharedCtx=undefined;activity?.attach(undefined);} }

/** All resume requests obey the page visibility/coverage policy, including late callers. */
export function resumePageAudioContext(ctx:AudioContext):void{
  if(activity!==undefined&&ctx===sharedCtx){activity.resume();return;}
  if(ctx.state!=='running')void ctx.resume().catch(()=>undefined);
}
