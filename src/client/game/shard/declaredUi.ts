import { mountDeclaredHud, textPanelFragment, type DeclaredHud, type DeclaredHudHandles, type DeclaredHudPorts } from '@wildshard/engine/ui/declared';
import type { ShardUi } from '@wildshard/format/ui';
import type { BagVerbs } from "../plugin/context";

/** the engine's HUD ports plus the shard's Bag */
export interface DeclaredUiPorts extends DeclaredHudPorts {
  /** the Bag's verbs for the shard's life (`ctx.bag`) */
  readonly bag: BagVerbs;
}

/**
 * SF7f: draw a shardfile's `ui` declarations. Markers, counters, boss panels and relabels go to the engine's shared HUD;
 * bag panels become a Bag tab (declared once per tab id) with a paragraph fragment. Everything leaves with the ports' scope.
 */
export function mountDeclaredUi(ui: ShardUi, ports: DeclaredUiPorts): DeclaredHudHandles {
  const hud: DeclaredHud[] = [], tabs = new Set<string>();
  for (const d of ui) {
    if (d.kind !== 'bagPanel') { hud.push(d); continue; }
    if (!tabs.has(d.tab.id)) { tabs.add(d.tab.id); ports.bag.tab({ id: d.tab.id, title: d.tab.title, icon: d.tab.icon, order: d.tab.order }); }
    ports.bag.fragment(d.tab.id, textPanelFragment({ id: d.id, order: d.order, paragraphs: d.paragraphs }));
  }
  return mountDeclaredHud(hud, ports);
}
