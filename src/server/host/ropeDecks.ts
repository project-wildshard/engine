import type { WorldAssemblyStage } from '@wildshard/format/worldAssembly';
import type { RigidBody } from '@dimforge/rapier3d-simd';
import type { SimHost } from '@wildshard/engine/sim';
import { rideable } from '@wildshard/engine/physics/CharacterMotor';
import { RopeChain } from '@wildshard/engine/physics/ropeChain';
import { tagOf } from '@wildshard/engine/physics/surface';
import type { ShardProduct } from '@wildshard/engine/game/shardfile/shardProduct';
import { registerInstalled } from '@wildshard/engine/game/shardfile/installedSides';

type RopeDeckStage = Extract<WorldAssemblyStage, { kind: 'rope-deck' }>;
type RopeChainStage = Extract<WorldAssemblyStage, { kind: 'rope-chain' }>;

/** Each admitted rope chain with the deck rows and baked span facts it is built from. */
export function ropeChainStages(product: ShardProduct | undefined): { readonly stage: RopeChainStage; readonly deck: RopeDeckStage; readonly facts: RopeDeckStage['site']['spans'][number] }[] {
  if (product?.has('client/plan') !== true) return [];
  const decks = new Map<string, RopeDeckStage>(), out: ReturnType<typeof ropeChainStages> = [];
  for (const feature of product.section('client/plan').features) {
    if (feature.kind !== 'world.assembly') continue;
    for (const stage of feature.rows.stages) {
      if (stage.kind === 'rope-deck') {
        if (decks.has(stage.id)) throw new Error('Duplicate native rope deck');
        decks.set(stage.id, stage);
      } else if (stage.kind === 'rope-chain') {
        const deck = decks.get(stage.deck); if (deck === undefined) throw new Error('Native rope chain needs its declared deck');
        const { span, site } = deck, rows = site.deck, key = JSON.stringify([span.a, span.b, span.width ?? rows.width, span.sag ?? rows.sag]);
        const facts = site.spans.find(row => row.key === key); if (facts === undefined) throw new Error('Unbaked native rope span');
        if (facts.segments.length > rows.maxSegments) throw new Error('Native rope deck exceeds its segment bound');
        out.push({ stage, deck, facts });
      }
    }
  }
  return out;
}

/**
 * NET-LAG NL5 (Jake, 2026-11-12: "i fucking clipped through the rope bridge because of the lag lol"). A rope bridge's span is
 * a RopeChain the page builds from its `client/plan` stages and stands the player on; the server built none, so its player
 * walked on air over the gully and fell, and the page's next correction pulled the player down through the planks. This
 * builds the same chain on the server's host from the same admitted stages.
 *
 * Coming back from a save, the installers run on a fresh world and the saved world is swapped in after them; it holds the
 * saved chain's bodies and joints (Rapier owns them). So the chain's adapter does the work once the saved world is in: it
 * lends the saved bodies back to the motor as rideable, or builds them for a room saved before NL5 (`joined`: none in it).
 */
export function installRopeDecks(host: SimHost, product: ShardProduct | undefined, coming: boolean): void {
  const stages = ropeChainStages(product), owners = stages.map(({ deck }) => JSON.stringify(deck.site.deck.owner));
  // a saved chain is found by its planks' owner: two decks of one site would each find both chains
  if (new Set(owners).size !== owners.length) throw new Error('Native rope decks need an owner each');
  if (stages.length > 0) registerInstalled(host, 'ropeDecks'); // SS3
  for (const { stage, deck, facts } of stages) {
    const rows = deck.site.deck;
    const build = (): void => {
      // The host's world owns the chain from here: it lives and is freed with the world, and nothing on the server reads its poses.
      new RopeChain(host.physics, { segments: structuredClone(facts.segments), hx: facts.width / 2 + rows.margin, hy: rows.halfY, mass: rows.mass,
        owners: facts.segments.map(() => ({ ...rows.owner })) });
    };
    const reconnect = (): void => {
      const saved: RigidBody[] = [], seen = new Set<number>();
      host.physics.world.forEachCollider(collider => {
        const owner = tagOf(collider)?.owner, body = collider.parent();
        if (body === null || seen.has(body.handle) || !body.isDynamic() || owner === null || typeof owner !== 'object' || !('id' in owner) || !('name' in owner)) return;
        if (owner.id === rows.owner.id && owner.name === rows.owner.name) { seen.add(body.handle); saved.push(body); }
      });
      if (saved.length === 0) { build(); return; }
      if (saved.length !== facts.segments.length) throw new Error('Saved native rope chain differs from its admitted segment count');
      for (const body of saved) rideable(body);
    };
    if (!coming) build();
    host.onStep(`rope-deck.${stage.id}`, () => undefined, { snapshot: () => 1, restore: () => undefined, physicsRestored: reconnect, joined: true });
  }
}
