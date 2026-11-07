import { prepareV2WorldActions, type V2WorldActionLoan } from '../../src/shared/game/shardfile/worldActionsV2';
import type { V2WorldAction } from '@wildshard/format/scriptActionsV2';

// Historical contract oracle; production consumers use the data-driven owners.
/** Existing direct application remains a whole-bank prepare/validate/apply.
 * Dismount reads mounted at each application and never adds an impulse. */
export function applyV2WorldActions(actions: readonly V2WorldAction[],loans: readonly V2WorldActionLoan[]): void {
  const prepared = prepareV2WorldActions(actions,loans);prepared.validate();
  for (const operation of prepared.operations) operation();
}
