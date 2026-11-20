import { expect, test } from "vitest";
import { ShardfileClient } from "../src/client/game/shardfile/client";
import {
  productCreaturesOwnPage,
  withoutRuntimeCreatures,
} from "../src/client/game/shardfile/runtimeCreatureOwner";
import { huntFixture } from "./fixtures/layer-hunt";
import { emptyShardfile } from "../src/shared/host/author";
import { FIXTURE_RUNTIME_COST } from "./fixtures/clientPlanRuntime";

// TEMPORARY (ONE-FORMAT OF22b4 bridge; OF27d removes it with this test): Driftwood's client plan keeps
// `population.product-creatures` while its server stands the roster as declared rows whose looks are placeholders.
const product = (features: { kind: string }[] | null) => ({
  has: (name: string) => name === "client/plan" && features !== null,
  section: () => ({ version: 1, features }),
});

test("a plan with product creatures owns the page's creatures; any other plan leaves them to the rows", () => {
  expect(productCreaturesOwnPage(product([{ kind: "population.product-creatures" }]) as never)).toBe(true);
  expect(productCreaturesOwnPage(product([{ kind: "species.program" }]) as never)).toBe(false);
  expect(productCreaturesOwnPage(product(null) as never)).toBe(false);
});

function roster() {
  const hunt = huntFixture(), source = emptyShardfile({ slug: "roster", name: "Roster", author: "Test", seed: 1, revision: 1 });
  source.rows = { ...source.rows, species: hunt.rows.species, strikes: hunt.rows.strikes };
  source.creatures = hunt.creatures;
  source.runtime = { kind: "client-plan", cost: FIXTURE_RUNTIME_COST, binds: [], spawns: { homes: [], bosses: [], actors: [] } } as never;
  source.rows.looks = source.rows.species.map((row) => ({ id: `fixture.look.${row.kind}`, species: row.id, recipe: "platform.rig", material: null,
    parameters: { library: "absent" }, animation: { recipe: "platform.rig", parameters: {} } }));
  return source;
}
function page(source: ReturnType<typeof roster>, creatureOwner?: "runtime") {
  return new ShardfileClient(source, { releaseTransport: () => undefined } as never, {
    instance: "roster", recipes: new Map(), items: new Map(), catalogue: [], voices: () => new Map(),
    icon: () => { throw new Error("No fixture items"); }, nativeRuntime: true, audioOwner: "runtime", worldOwner: "runtime",
    ...(creatureOwner === undefined ? {} : { creatureOwner }) } as never);
}

test("beside product creatures a declared roster registers no second look and the page keeps its mode", async () => {
  const source = roster(), bare = withoutRuntimeCreatures(source);
  expect(bare.creatures.spawns).toEqual([]);
  expect(bare.rows.looks).toEqual([]);
  expect(bare.rows.strikes).toEqual([]);
  // the rows alone would make the runtime page a full data page drawing its own looks
  expect(Reflect.get(page(source), "mode")).toBe("full");
  const owned = page(source, "runtime"), untouched = new Proxy({}, { get: (_target, key) => { throw new Error(`page touched ${String(key)}`); } });
  expect(Reflect.get(owned, "mode")).toBe("empty");
  expect(Reflect.get(page(bare), "mode")).toBe("empty");
  expect(Reflect.get(owned, "source").rows.looks).toEqual([]);
  // the kit stage reads no rig library for the placeholder look and registers nothing
  await expect(Promise.resolve().then(() => Reflect.apply(Reflect.get(owned, "kitData") as (ctx: unknown) => void, owned, [untouched]))).resolves.toBeUndefined();
});
