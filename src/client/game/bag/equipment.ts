import type { GearTool } from './bag';
import type { Tool } from '@wildshard/engine/combat/Tool';
import type { Weapon } from '@wildshard/engine/combat/Weapon';
import type { KitEntry } from '@wildshard/engine/ui/Menu';

/** The Bag reads authored metadata; ammo and selected state remain live weapon state. */
export function equipmentEntry(w: Weapon, current: Weapon, suffix = ''): KitEntry {
  const ui = w.row.ui, ammo = ui.ammo;
  return { id: w.id, name: w.meta.name + suffix, icon: w.meta.icon, melee: ui.melee, tracers: ui.tracers,
    huntersEye: ui.huntersEye === true,
    ammoLabel: ammo?.bagLabel !== undefined && w.ammoLabel === ammo.bagLabelFor ? ammo.bagLabel : w.ammoLabel,
    ammo: w.state.ammo ?? 0, magazine: w.state.magazine, reserve: w.state.reserve, equipped: w === current };
}

/** Every carried tool builds the same GEAR card from its authored metadata. */
export function toolEntries(tools: readonly Tool[], text: (key: string) => string): GearTool[] {
  return tools.map((tool) => ({ id: tool.id.replace(/^tool\./, ''), name: text(tool.meta.name), kind: tool.meta.category, how: tool.meta.blurb, icon: tool.meta.icon }));
}
