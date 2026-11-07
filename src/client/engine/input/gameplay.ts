import type { Player } from '../player/Player';
import type { EquipmentService } from '../combat/EquipmentService';
import type { Scope } from '../../../shared/engine/app/scope';
import { app } from '../app/runtime';
import type { InputContextDef } from '../../../server/engine/level/context';

/** The level installs one device listener set; mode contexts compose with plugin verbs. */
export function installGameplayInput(player: Player, canvas: HTMLCanvasElement, scope: Scope, contexts: readonly InputContextDef[]): void {
  const input = app.input;
  player.inputService = input;
  input.captureAim = () => player.sampleAimCommand();
  scope.onDispose(() => { input.captureAim = null; });
  input.install(scope, canvas, (x, y) => { player.look(x, y); });
  for (const def of contexts) input.register(def, scope);
  input.push('onFoot', scope);
  app.ui.connectInput(input, app.engineScope);
  scope.listen(document, 'pointerlockchange', () => { player.locked = document.pointerLockElement === canvas; });
  const mode = (id: string, on: boolean): void => { if (on) input.push(id, scope); else input.pop(id); };
  app.addSystem({ id: 'engine.input.contexts', phase: 'input', before: ['engine.input.collect', 'engine.player.input'], run: () => {
    mode('swim', player.swimming); mode('board', player.hover);
    mode('explore', app.state === 'explore');
    input.refresh(); input.repaint();
  } }, scope);
  app.addSystem({ id: 'engine.input.edges', phase: 'late', run: () => { input.endFrame(); } }, scope);
}
export function weaponInputContext(equipment: EquipmentService, scope: Scope): void {
  const input = app.input;
  let current = '';
  app.addSystem({ id: 'engine.input.weapon', phase: 'input', before: ['engine.input.contexts'], run: () => {
    const next = equipment.current.row.ui.inputContext ?? '';
    if (next !== current) { if (current !== '') input.pop(current); if (next !== '') input.push(next, scope); current = next; }
  } }, scope);
}
