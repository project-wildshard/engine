import type { Scope } from '../../../shared/engine/app/scope';
import type { EquipmentAction } from '../../../shared/engine/combat/Tool';

export interface EquipmentInput { bind: (action: EquipmentAction, run: () => void, scope: Scope, allowed?: () => boolean) => void }
