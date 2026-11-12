// TE-ENG3: a data shard's quest-givers (`targets.talks`) on the page. A figure stands at the row's feet (its props model, or a
// stand-in when it names none); E opens the dialogue box on the node the server says this player is at. An answer goes to the
// server by position and the next node opens once the server says it; a node with no choices ends the talk.
import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import { test } from '@wildshard/engine/world/interact/flags';
import type { DialogueChoice } from '@wildshard/engine/quest/view/ui';
import { TALK_HEIGHT, talkChoice, talkFinish, talkLine, talkNode, type TalkRow } from '../../../shared/game/shardfile/talks';

/** The dialogue box a talk opens: the HUD's, or a test's. */
export interface TalkBox {
  readonly isOpen: boolean;
  open: (name: string, lines: string[], onDone: () => void, choices?: readonly DialogueChoice[]) => void;
  close: (finished?: boolean) => void;
  update: (dt: number) => void;
  /** Replace the open node's choices, its lines kept. */
  offer: (choices: readonly DialogueChoice[]) => void;
}
/** What a page's talks read and send. */
export interface TalkPorts {
  readonly root: Object3D; readonly scope: Scope; readonly interactables: Interactable[]; readonly system: (spec: SystemSpec) => void;
  /** This player's flags, as the server last said them: a choice's condition reads them. */
  readonly flags: { has: (flag: string) => boolean };
  /** One of this player's owned lines; 0 when the server has said none. */
  readonly line: (name: string) => number;
  /** One press, by name, to the server. */
  readonly send: (id: string) => void;
  readonly box: () => TalkBox;
  /** The player's feet: walking off closes the talk. */
  readonly player: () => { readonly x: number; readonly z: number };
}
/** A talk past its reach by this much closes, as a native NPC's does. */
const LEAVE = 2.5;

/** The stand-in figure: a body and a head, about a person's height, feet at the origin. Never a combat target. */
function standIn(scope: Scope): Group {
  const figure = new Group(), cloth = new MeshStandardMaterial({ color: 0x6f7f5a, roughness: 0.9 }), skin = new MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.8 });
  const bodyShape = new CapsuleGeometry(0.28, 0.9, 4, 12), headShape = new SphereGeometry(0.2, 16, 12);
  const body = new Mesh(bodyShape, cloth), head = new Mesh(headShape, skin);
  body.position.y = 0.73; head.position.y = 1.5;
  body.castShadow = head.castShadow = true;
  figure.add(body, head);
  scope.onDispose(() => { figure.removeFromParent(); for (const owned of [cloth, skin, bodyShape, headShape]) owned.dispose(); });
  return figure;
}

/** How long an answer waits for the server's next node before the page stops waiting (a refused answer moves nothing). */
const ANSWER_WAIT = 3;

/** Install every talk a shard declares; the returned talks are what a proof reads. */
export function installDeclaredTalks(source: Pick<Shardfile, 'targets' | 'quests'>, ports: TalkPorts): { readonly id: string; readonly prompt: Interactable; readonly node: () => string | null | undefined }[] {
  const talks = source.targets.talks ?? [];
  type Tree = Shardfile['quests']['dialogue'][number];
  type Node = Tree['nodes'][number];
  interface Open { readonly talk: TalkRow; readonly index: number; readonly tree: Tree; readonly node: Node; shown: string }
  /** The talk the box shows now, and which of its choices it offers. */
  let open: Open | null = null;
  /** An answer sent, waiting for the server's next node: the line it stood at, and how long it has waited. */
  let pending: { readonly talk: TalkRow; readonly index: number; readonly tree: Tree; readonly from: number; waited: number } | null = null;
  const lineOf = (tree: Tree): number => ports.line(talkLine(tree.id));
  const offered = (node: Node): Node['choices'] => node.choices.filter(choice => test(ports.flags, choice.when));
  const choicesOf = (index: number, tree: Tree, node: Node, talk: TalkRow): DialogueChoice[] => offered(node).map((choice): DialogueChoice => ({ label: choice.label, pick: () => {
    // The server takes the answer and says the next node; the page shows it once it has, so a refused answer moves nothing.
    ports.send(talkChoice(index, tree.nodes.indexOf(node), node.choices.indexOf(choice)));
    open = null; pending = { talk, index, tree, from: lineOf(tree), waited: 0 };
  } }));
  const show = (talk: TalkRow, index: number, tree: Tree, node: Node): void => {
    const choices = choicesOf(index, tree, node, talk);
    open = { talk, index, tree, node, shown: offered(node).map(choice => choice.id).join('\n') };
    // A node with no choices at all ends the talk once read; one whose choices all wait on a flag just closes, and stays.
    ports.box().open(tree.name, [...node.lines], () => { open = null; if (node.choices.length === 0) ports.send(talkFinish(index)); }, choices);
  };
  const installed = talks.map((talk, index) => {
    const tree = source.quests.dialogue.find(row => row.id === talk.dialogue);
    if (tree === undefined) throw new Error(`Talk requires its declared dialogue: ${talk.dialogue}`);
    if (talk.figure === undefined) { const figure = standIn(ports.scope); figure.position.set(...talk.at); ports.root.add(figure); }
    const node = (): ReturnType<typeof talkNode> => talkNode(tree, lineOf(tree));
    const prompt: Interactable = {
      position: new Vector3(talk.at[0], talk.at[1] + TALK_HEIGHT, talk.at[2]), label: talk.label,
      // hidden while a talk is open or an answer waits, before the server has said a node, and once the talk is over
      get radius() { const current = node(); return open !== null || pending !== null || ports.box().isOpen || current === null || current === undefined ? 0 : talk.radius; },
      onInteract: () => { const current = node(); if (current !== null && current !== undefined && !ports.box().isOpen && pending === null) show(talk, index, tree, current); },
    };
    ports.interactables.push(prompt);
    ports.scope.onDispose(() => { const at = ports.interactables.indexOf(prompt); if (at !== -1) ports.interactables.splice(at, 1); });
    return { id: talk.id, prompt, node: () => { const current = node(); return current === null || current === undefined ? current : current.id; } };
  });
  if (talks.length > 0) ports.system({ id: 'shardfile.talks', phase: 'update', run: dt => {
    const box = ports.box();
    box.update(dt);
    const waiting = pending;
    if (waiting !== null) {
      const line = lineOf(waiting.tree);
      waiting.waited += dt;
      if (line !== waiting.from) {
        pending = null;
        const next = talkNode(waiting.tree, line);
        if (next !== null && next !== undefined && !box.isOpen) show(waiting.talk, waiting.index, waiting.tree, next);
      } else if (waiting.waited > ANSWER_WAIT) pending = null;
    }
    const talking = open;
    if (talking === null) return;
    if (!box.isOpen) { open = null; return; }
    const feet = ports.player();
    if (Math.hypot(feet.x - talking.talk.at[0], feet.z - talking.talk.at[2]) > talking.talk.radius + LEAVE) { box.close(false); open = null; return; }
    // The flags a choice reads come from the server too: when they change, the box offers what holds now.
    const shown = offered(talking.node).map(choice => choice.id).join('\n');
    if (shown !== talking.shown) { talking.shown = shown; box.offer(choicesOf(talking.index, talking.tree, talking.node, talking.talk)); }
  } });
  return installed;
}
