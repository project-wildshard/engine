import { AnimationMixer, type AnimationAction, LoopOnce } from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import { ClipChannel } from './channel';
import type { ClipName, RigInstance, RigRef } from './rig';

export interface AnimState { clip: ClipName; fade: number; hold?: boolean }
export interface AnimMachineDef {
  states: Readonly<Record<string, AnimState>>;
  loops?: readonly ClipName[];
}
/** Visual only: HFSMs/viewmodel blocks supply states; animation never dispatches a gameplay hit. */
export class AnimMachine {
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<ClipName, AnimationAction>();
  private readonly channels: ClipChannel[] = [];
  private live = true;
  private current: string | null = null;
  private stateChannel: ClipChannel | undefined;
  private forgetScope: (() => void) | undefined;
  readonly def: AnimMachineDef;
  readonly rig: RigInstance;
  constructor(def: AnimMachineDef, rig: RigInstance, scope?: Scope) {
    this.def = def; this.rig = rig;
    this.mixer = new AnimationMixer(rig.root);
    for (const [name, clip] of rig.clips) {
      const action = this.mixer.clipAction(clip);
      if (!def.loops?.includes(name)) { action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; }
      this.actions.set(name, action);
    }
    for (const state of Object.values(def.states)) this.action(state.clip);
    const forget = scope?.capture('disposers', () => { this.dispose(); });
    // A closed scope disposes synchronously while capture is registering.
    if (this.live) this.forgetScope = forget;
    else forget?.();
  }
  get state(): string | null { return this.current; }
  action(name: ClipName): AnimationAction {
    const action = this.actions.get(name);
    if (action === undefined) throw new Error(`[anim] ${this.rig.contract.skeleton}: no playable clip ${name}`);
    return action;
  }
  channel(base: ClipName, walk?: ClipName): ClipChannel {
    const channel = new ClipChannel(this.action(base), walk === undefined ? null : this.action(walk));
    this.channels.push(channel);
    return channel;
  }
  /** Supply a base for the state channel; named transition rows carry authored crossfade times. */
  base(clip: ClipName, walk?: ClipName): ClipChannel {
    if (this.stateChannel !== undefined) throw new Error('[anim] state channel already bound');
    this.stateChannel = this.channel(clip, walk);
    return this.stateChannel;
  }
  transition(state: string, restart = false): void {
    if (!this.live || (state === this.current && !restart)) return;
    const row = this.def.states[state];
    if (row === undefined) throw new Error(`[anim] unknown state ${state}`);
    if (this.stateChannel === undefined) throw new Error('[anim] transition requires a base channel');
    this.stateChannel.play(this.action(row.clip), state, row.fade, row.hold ?? false);
    this.current = state;
  }
  /** Channels are updated by their driver first (walk phase/speed can differ per arm). */
  update(dt: number): void { if (this.live) this.mixer.update(dt); }
  dispose(): void {
    if (!this.live) return;
    this.live = false;
    const forget = this.forgetScope;
    this.forgetScope = undefined;
    forget?.();
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.rig.root);
    this.actions.clear(); this.channels.length = 0;
    this.stateChannel = undefined;
  }
}
export interface AnimService {
  load: (ref: RigRef) => Promise<RigInstance>;
  machine: (def: AnimMachineDef, rig: RigInstance, scope: Scope) => AnimMachine;
}
