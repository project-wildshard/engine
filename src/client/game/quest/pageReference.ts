import type { Scope } from '@wildshard/engine/app/scope';
import type { PlaceArea } from '@wildshard/engine/quest/lastPlace';
import type { QuestPageComposition } from './pageComposition';

/** Stable entered publication for readers captured before composition exists.
 * It borrows the actual quest; its owner keeps all continuation and disposal. */
export class QuestPageReference {
  private value: QuestPageComposition | null = null;
  constructor(private readonly scope: Scope) { scope.onDispose(() => { this.value = null; }); }
  /** This function identity is stable before publication and throughout entry. */
  readonly places = (): readonly PlaceArea[] => this.scope.disposed || this.scope.disposing ? [] : this.value?.places?.points ?? [];
  /** Exactly one completed composition may publish into the entered reference. */
  publish(value: QuestPageComposition): void {
    if (this.scope.disposed || this.scope.disposing || this.value !== null) throw new Error('Quest reference is expired or already published');
    this.value = value;
  }
}
