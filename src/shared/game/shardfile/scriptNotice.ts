/**
 * A disabled script tells the player (SHARD-PLATFORM SF58 (13), G168 / G115, `art/hud/round-22-script-error/board.jpg`):
 * when a shard module crosses its failure limit and the host switches it off (its thing freezes), the player gets one amber
 * toast "SOMETHING IN THIS SHARD STOPPED WORKING" under the quest chip, and with Settings ▸ Developer on a red strip names the
 * module and its cause ("SCRIPT DISABLED · door.wasm · out of fuel ×3"). Module names are author data: the HUD sets both
 * lines through textContent only.
 */
import type { ShardScriptPorts } from '../../../server/game/shardfile/scripts';
import { GAME_STRINGS } from '../strings';

/** The HUD ports the notice uses (the page HUD's `toast(text, 'warn')` and `devAlert`). */
export interface ScriptNoticePorts { toast: (text: string) => void; devAlert: (text: string) => void }

/** What the host reports for a module it switched off (the engine's `ScriptDisabled`, read through the format's ports). */
type ScriptDisabled = Parameters<NonNullable<ShardScriptPorts['onDisabled']>>[0];

const CAUSE_LENGTH = 40;
/** The host's failure reason as the Developer strip's short cause. */
export function scriptCause(reason: string): string {
  const s = GAME_STRINGS.script;
  if (/fuel/iu.test(reason)) return s.outOfFuel;
  if (/call-depth/iu.test(reason)) return s.callDepth;
  if (/query allowance/iu.test(reason)) return s.queries;
  if (/effect allowance/iu.test(reason)) return s.effects;
  if (/^script (trap|abort)$/iu.test(reason)) return s.trap;
  const plain = reason.trim().toLowerCase();
  return plain.length > CAUSE_LENGTH ? `${plain.slice(0, CAUSE_LENGTH - 1)}…` : plain;
}

/** One notice per shard session: the player's toast once (a second module going down adds no toast), the Developer strip
 *  for every disabled module (the newest replaces the last). */
export function scriptDisabledNotice(ports: ScriptNoticePorts): (disabled: ScriptDisabled) => void {
  let told = false;
  return (disabled) => {
    if (!told) { told = true; ports.toast(GAME_STRINGS.script.stopped); }
    ports.devAlert(GAME_STRINGS.script.disabled(disabled.module, scriptCause(disabled.reason), disabled.failures));
  };
}
