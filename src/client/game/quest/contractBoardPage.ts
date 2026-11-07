/** Client-only board presentation. The native ContractBoard owns every offer;
 * this binding keeps the existing page panel, prompt, save and payout owners. */
import { wirePage } from '../shardfile/wirePage';
import * as v from 'valibot';
import { Vector3 } from 'three';
import type { ContractBoardPageRows, ContractReward } from '@wildshard/format/contracts';
import { jsonSchema, jsonSlot } from '@wildshard/engine/saves/slots';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { InteractSfx } from '@wildshard/engine/audio/interactSfx';
import type { ShardContext } from '../plugin/context';
import { bindRuntimeState } from '../../../shared/game/plugin/runtimeRows';
import { QuestViews } from '../plugin/ui';
import { enteredHeldLoadout } from '../loadout/held';
import { HeldFinishes } from '../loadout/finishes';
import { DataPanel } from '../ui/dataPanels';
import { ContractBoard } from '../../../shared/game/quest/contractBoard';
import { saveBoard, isFilled, ownContractCatalogue, type Board } from '../../../shared/game/quest/contracts';

/** Existing page resources returned to the entry's original modal/debug phases. */
export interface ContractBoardPage {
  readonly state: Board;
  readonly panel: () => DataPanel;
  readonly fill: (slot: number) => void;
  /** Install deaths at the caller's existing phase, after its earlier death rows. */
  readonly observe: () => void;
}
function notice(template: string, values: Readonly<Record<string, string | number>>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(values)) rendered = rendered.replaceAll(`{${key}}`, String(value));
  return rendered;
}
/** Framework-only binding: author input enters through QuestEntry.board as JSON;
 * the entry lends its already-installed sound and achievement services. */
export function installContractBoardPage(ctx: ShardContext, rows: ContractBoardPageRows, sfx: InteractSfx): ContractBoardPage {
  if (ctx.scope.disposed) throw new Error('Quest board requires a live owner');
  const panelRows = rows.panel;
  const runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play;
  if (runtime === undefined || world === undefined || world === null || play === undefined || play === null) throw new Error('Quest board requires entered play owners');
  const loadout = rows.ammunition === undefined ? null : enteredHeldLoadout(ctx.scope, rows.ammunition.loadout);
  if (loadout === null && rows.contracts.rows.some(row => row.reward.bolts > 0)) throw new Error('Quest board requires its declared ammunition owner');
  const finishes = new Map(Object.entries(rows.finishes).map(([key, caption]) => [key, { finish: HeldFinishes.current(ctx.manifest.slug).get(key), text: caption }]));
  const legacy = jsonSlot(rows.store.slot, 'shard');
  const saved = bindRuntimeState(ctx, ctx.product.shardfile, rows.store.state, () => JSON.stringify(legacy.read(ctx.manifest.slug)), ctx.manifest.slug);
  const contracts = ownContractCatalogue(rows.contracts, ctx.scope);
  const owner = new ContractBoard({ contracts, saved: String(saved.read()), radius: rows.radius,
    prompt: { x: rows.at.x, y: terrainHeight(rows.at.x, rows.at.z) + rows.height, z: rows.at.z } }), board = owner.current;
  const persist = (): void => { try { const raw = saveBoard(board); v.parse(jsonSchema, JSON.parse(raw) as unknown); saved.write(raw); } catch { /* storage unavailable */ } };
  const views = new QuestViews(ctx);
  /** What a claim changes in the player's hands. */
  const inHand = (reward: ContractReward): void => {
    if (reward.bolts > 0 && rows.ammunition !== undefined) loadout?.addAmmo(rows.ammunition.kind, reward.bolts);
    if (reward.skin === undefined) return;
    const finish = finishes.get(reward.skin); if (finish === undefined) throw new Error('Missing admitted board finish');
    play.skins.own(reward.skin); play.wearSkin(finish.finish); play.hud.toast(finish.text);
  };
  const paid = (): void => { sfx.interact('chest'); play.music.sting('pickup'); play.hud.toast(notice(rows.notices.claimed, { claimed: board.claimed, streak: board.streak })); };
  /** The press the rows haven't answered: the server judges a claim, so what it pays plays when its count moves. */
  let claiming: { readonly reward: ContractReward | null; readonly claimed: number } | null = null;
  /** The server's board, onto this page's: what a page's own claim and kills would have said, as its lines move. */
  const mirror = (raw: string): void => {
    const before = board.slots.map(slot => ({ serial: slot.serial, have: slot.have }));
    owner.mirror(raw);
    if (claiming !== null && board.claimed > claiming.claimed) { const { reward } = claiming; claiming = null; if (reward !== null) inHand(reward); paid(); }
    board.slots.forEach((slot, index) => { const was = before[index]; if (was?.serial === slot.serial && slot.have > was.have) play.hud.toast(notice(isFilled(slot) ? rows.notices.filled : rows.notices.progress, { goal: slot.goal, have: slot.have, need: slot.need })); });
  };
  const panel = views.view('board', scope => new DataPanel(panelRows, { scope, values: () => board, actions: new Map([
    ['claim', (value: unknown): void => {
      if (typeof value !== 'number') throw new Error('Contract action requires its slot');
      claiming = { reward: board.slots[value]?.reward ?? null, claimed: board.claimed }; wirePage.contract('claim', value);
    }],
    ['tear', (value: unknown): void => { if (typeof value !== 'number') throw new Error('Contract action requires its slot'); wirePage.contract('tear', value); sfx.interact('door'); }],
  ]) }));
  const prompt: Interactable = { position: new Vector3(rows.at.x, terrainHeight(rows.at.x, rows.at.z) + rows.height, rows.at.z),
    get radius() { return panel().isOpen ? 0 : rows.radius; }, get label() { return board.slots.some(isFilled) ? rows.filled : rows.label; },
    onInteract: () => { panel().open(); sfx.interact('door', prompt.position, { gain: 0.5 }); } };
  runtime.interactables.push(prompt);
  ctx.scope.onDispose(() => { const index = runtime.interactables.indexOf(prompt); if (index !== -1) runtime.interactables.splice(index, 1); views.disposeLegacy(() => { panel().root.remove(); }); });
  wirePage.hold({ board: { mirror } }, ctx.scope);
  let observing = false;
  return { state: board, panel, fill: slot => { const row = board.slots[slot]; if (row !== undefined) { row.have = row.need; persist(); } }, observe: () => {
    if (observing || ctx.scope.disposed) throw new Error('Quest board deaths already installed or disposed'); observing = true;

  } };
}
