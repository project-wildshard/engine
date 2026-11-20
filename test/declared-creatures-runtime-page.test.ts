import { expect, test } from "vitest";
import { ShardfileClient } from "../src/client/game/shardfile/client";
import { huntFixture } from "./fixtures/layer-hunt";
import { emptyShardfile } from "../src/shared/host/author";
import { FIXTURE_RUNTIME_COST } from "./fixtures/clientPlanRuntime";

// ONE-FORMAT OF27d: Driftwood's creatures draw from their skin look rows, so a runtime page's data client draws its
// declared roster. The OF22b4 bridge that handed the creatures to the client plan's `population.product-creatures`
// (runtimeCreatureOwner.ts, the `creatureOwner` binding) is gone: no binding empties the roster.
function roster() {
  const hunt = huntFixture(), source = emptyShardfile({ slug: "roster", name: "Roster", author: "Test", seed: 1, revision: 1 });
  source.rows = { ...source.rows, species: hunt.rows.species, strikes: hunt.rows.strikes };
  source.creatures = hunt.creatures;
  source.runtime = { kind: "client-plan", cost: FIXTURE_RUNTIME_COST, binds: [], spawns: { homes: [], bosses: [], actors: [] } } as never;
  source.rows.looks = source.rows.species.map((row) => ({ id: `fixture.look.${row.kind}`, species: row.id, recipe: "platform.rig", material: null,
    parameters: { library: "absent" }, animation: { recipe: "platform.rig", parameters: {} } }));
  return source;
}

test("a runtime page's data client draws its declared roster whatever its bindings say", () => {
  const source = roster();
  const page = new ShardfileClient(source, { releaseTransport: () => undefined } as never, {
    instance: "roster", recipes: new Map(), items: new Map(), catalogue: [], voices: () => new Map(),
    icon: () => { throw new Error("No fixture items"); }, nativeRuntime: true, audioOwner: "runtime", worldOwner: "runtime",
    creatureOwner: "runtime" } as never);
  expect(Reflect.get(page, "mode")).toBe("full");
  const drawn = Reflect.get(page, "source") as typeof source;
  expect(drawn.rows.looks).toEqual(source.rows.looks);
  expect(drawn.creatures.spawns).toEqual(source.creatures.spawns);
});
