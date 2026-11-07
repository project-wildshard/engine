import { Scope } from './scope';
import { currentOwner } from './ownership';

/** Page services outlive level disposal and never borrow a level's construction owner. */
export const pageScope: Scope = new Scope('page');
/** Explicit fallback for reusable services constructed before the app installs a level. */
export function resourceScope(): Scope { return currentOwner() ?? pageScope; }
