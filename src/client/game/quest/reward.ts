import type { Scope } from '@wildshard/engine/app/scope';
import { RewardCaption } from '@wildshard/engine/quest/view/ui';
import { QuestRewardController, type QuestRewardPosePlayer, type QuestRewardPoseTarget } from '../../../shared/game/plugin/quests';

export interface QuestRewardPlayer extends QuestRewardPosePlayer { carried: boolean }
export interface QuestRewardSpec extends QuestRewardPoseTarget {
  kicker: string; title: string; subtitle: string;
  /** Start once this holds; the beat runs once per installation. Saved flags belong in this predicate. */
  when: () => boolean;
  holdSeconds?: number;
  /** Raise the reward flag / award loot here. Return true if a completion card takes camera ownership. */
  finish: () => boolean | undefined;
}
export interface QuestRewardHost {
  scope: Scope;
  player: QuestRewardPlayer;
  dayNight?: { phase: number } | null;
  objective?: HTMLElement;
  setViewmodel?: (on: boolean) => void;
  sting: () => void;
}

/** Wendell's held reward view: the same caption, 2.5 s camera ease, 3.5 s clock ease and 7 s hold. A beat that names no
 * pose shows the caption and sting only: the player keeps the camera, the walk and the weapon in hand. */
export class QuestRewardBeat {
  private readonly caption: RewardCaption;
  private readonly motion: QuestRewardController;
  constructor(private readonly host: QuestRewardHost, spec: QuestRewardSpec) {
    this.caption = new RewardCaption(spec.kicker, spec.title, spec.subtitle);
    this.motion = new QuestRewardController(host.player, host.dayNight, spec, {
      start: () => {
        this.caption.show(true); if (this.motion.holdsPlayer) host.setViewmodel?.(false);
        host.objective?.classList.add('ws-quest-hide'); host.sting();
      },
      finish: () => { this.caption.show(false); },
      release: () => {
        if (this.motion.holdsPlayer) host.setViewmodel?.(true);
        host.objective?.classList.remove('ws-quest-hide');
      },
    });
    host.scope.onDispose(() => { this.motion.dispose(); this.caption.scope.dispose(); });
  }
  get active(): boolean { return this.motion.active; }
  /** An admitted director may supply completion explicitly; the local elapsed clock then serves presentation only. */
  update(dt: number, authoritativeFinish?: boolean): void {
    if (!this.host.scope.disposed) this.motion.update(dt, authoritativeFinish);
  }
}
