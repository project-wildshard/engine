import { engineString } from '../strings';
/** Development-only diagnostic; content supplies both entity and module names. */
export function scriptFailure(entity: string, module: string, reason: string, disabled: boolean): string {
  return engineString('s_script_failure', [entity, module, reason, disabled ? engineString('s_script_disabled') : '']);
}
