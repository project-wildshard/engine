// Actual admitted data entry and its public render/read ports; no prepare() replacement or WebGL claim.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Window } from "happy-dom";
import { Vector3 } from "three";

const page = new Window({ url: "http://127.0.0.1/hybrid-render-owner" }),
  borrowed = new Map();
for (const name of [
  "window",
  "document",
  "location",
  "localStorage",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "PointerEvent",
  "HTMLCanvasElement",
  "ResizeObserver",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  borrowed.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  const value = name === "window" ? page : page[name];
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: typeof value === "function" && /^[a-z]/u.test(name) ? value.bind(page) : value,
  });
}
const { Scope } = await import("../../src/shared/engine/app/scope.ts");
const { app } = await import("../../src/client/engine/app/runtime.ts");
const { createLevelInstallation } = await import("../../src/client/engine/level/installation.ts");
const { shardContext, sourceManifest } = await import("../../src/client/game/plugin/context.ts");
const { installEnteredRuntimeService } =
  await import("../../src/client/game/shard/retainedHooks.ts");
const { HybridRuntimeSession } = await import("../../src/client/game/shardfile/hybrid.ts");
const { emptyShardfile } = await import("../../src/shared/host/author.ts");
const { createShardProduct } = await import("../../src/shared/game/shardfile/shardProduct.ts");

function fixture(refusal) {
  const scope = new Scope("hybrid-render-owner"),
    render = Promise.withResolvers(),
    world = Promise.withResolvers(),
    admitted = Promise.withResolvers();
  const source = emptyShardfile({
      slug: "render-owner",
      name: "Render owner",
      author: "Lifecycle contract",
      revision: 1,
      seed: 7,
    }),
    manifest = sourceManifest(source);
  const original = createShardProduct({
    slug: manifest.slug,
    revision: 1,
    shardfile: source,
    sections: new Map([
      ["client/plan", { version: 1, features: [{ kind: "strings.register" }] }],
      ["ui/strings", { proof_render_owner: "Entered only" }],
    ]),
    files: new Map(),
    read: () => Promise.reject(new Error("No external file belongs to this entry")),
  });
  const events = [],
    failure = new Error(`Original ${refusal ?? "unused"} refusal`);
  let contexts = 0;
  // The product reader is a public loader port. Both refusals originate in actual admission/install consumers.
  const product = {
    ...original,
    section(name) {
      if (name === "client/plan") {
        admitted.resolve();
        if (refusal === "admission") throw failure;
      }
      if (name === "ui/strings" && contexts > 0) {
        events.push("world");
        world.resolve();
        if (refusal === "world") throw failure;
      }
      return original.section(name);
    },
  };
  const runtime = {
    world: null,
    step: null,
    play: null,
    interactables: [],
    overhead: [],
    objects: {},
    hooks: {},
    viewer: () => new Vector3(),
    horizonVeil: null,
  };
  const resident = {
    instance: "owner",
    slug: manifest.slug,
    declaration: null,
    product,
    firstParty: true,
    retainRuntime: true,
    scope,
    runtime,
    renderReady: render.promise,
    context(owner, local) {
      contexts++;
      const installation = createLevelInstallation(app, owner, {}, () => ({
        set: () => undefined,
        detail: () => undefined,
      }));
      const context = shardContext(
        installation.context,
        manifest,
        {
          shard: manifest,
          runtime: local,
          rows: new Map(),
          bag: { tab: () => () => undefined, fragment: () => () => undefined },
        },
        product,
      );
      owner.onDispose(() => {
        events.push("dispose");
      });
      return {
        ...installation,
        context,
        prepareConstruction() {
          events.push("construct");
          return () => {
            events.push("restore");
          };
        },
        beforeWorld(entered) {
          installEnteredRuntimeService(entered, () => {
            events.push("visible");
          });
        },
        afterWorld() {
          events.push("afterWorld");
        },
        afterKit() {
          events.push("afterKit");
        },
      };
    },
  };
  const session = new HybridRuntimeSession(new Map([["owner", resident]]), scope);
  return {
    scope,
    render,
    world,
    admitted,
    events,
    failure,
    session,
    manifest,
    contexts: () => contexts,
    visible: () => app.levelRegistrations.findText("proof_render_owner"),
    cell: { instance: "owner", slug: manifest.slug },
  };
}
function timed(name, work) {
  void test(name, { timeout: 9500 }, async () => {
    const started = performance.now();
    await work();
    assert.ok(
      performance.now() - started < 9500,
      "Complete render preparation proof exceeds 9.5 seconds",
    );
  });
}
async function cleanup(f) {
  f.render.resolve();
  f.scope.dispose();
  assert.equal(f.visible(), undefined);
}

timed(
  "actual private data world overlaps render while entered strings and kit remain gated",
  async () => {
    const f = fixture();
    try {
      const preparing = f.session.prepareEntry("owner");
      await f.world.promise;
      await nextTurn();
      assert.deepEqual(f.events, ["construct", "world"]);
      assert.equal(f.session.state().ready, false);
      assert.equal(f.visible(), undefined);
      assert.ok(
        f.session.timings().completed.some((row) => row.hook === "world" && row.outcome === "done"),
      );
      f.render.resolve();
      assert.equal(await preparing, true);
      assert.deepEqual(f.events, ["construct", "world", "afterWorld", "afterKit", "restore"]);
      assert.equal(f.visible(), undefined);
      assert.equal(await f.session.enter(f.cell), true);
      assert.equal(f.events.at(-1), "visible");
      assert.equal(f.visible(), "Entered only");
    } finally {
      await cleanup(f);
    }
  },
);

timed(
  "ordinary data activation waits for the same render fence before any world/context binding",
  async () => {
    const f = fixture();
    try {
      const entering = f.session.enter(f.cell);
      await f.admitted.promise;
      await nextTurn();
      assert.deepEqual(f.events, []);
      assert.equal(f.contexts(), 0);
      assert.equal(f.visible(), undefined);
      f.render.resolve();
      assert.equal(await entering, true);
      assert.deepEqual(f.events, ["visible", "world", "afterWorld", "afterKit"]);
      assert.equal(f.visible(), "Entered only");
    } finally {
      await cleanup(f);
    }
  },
);

timed(
  "actual world reader refusal drains started rendering and retains the original error",
  async () => {
    const f = fixture("world");
    let finished = false;
    try {
      const settled = f.session
        .prepareEntry("owner")
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        .finally(() => {
          finished = true;
        });
      await f.world.promise;
      await nextTurn();
      assert.equal(finished, false);
      assert.deepEqual(f.events, ["construct", "world"]);
      f.render.reject(new Error("Later render refusal"));
      assert.deepEqual(await settled, { error: f.failure });
      assert.deepEqual(f.events, ["construct", "world", "dispose", "restore"]);
      assert.equal(f.session.state().ready, false);
      assert.equal(f.visible(), undefined);
    } finally {
      await cleanup(f);
    }
  },
);

timed("render refusal publishes no afterWorld kit or entered strings", async () => {
  const f = fixture(),
    failure = new Error("Original render refusal");
  try {
    const settled = f.session.prepareEntry("owner").then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await f.world.promise;
    f.render.reject(failure);
    assert.deepEqual(await settled, { error: failure });
    assert.deepEqual(f.events, ["construct", "world", "dispose", "restore"]);
    assert.equal(f.session.state().ready, false);
    assert.equal(f.visible(), undefined);
  } finally {
    await cleanup(f);
  }
});

timed(
  "cancellation during render drains the allocation and cannot activate later hooks",
  async () => {
    const f = fixture(),
      controller = new AbortController();
    let finished = false;
    try {
      const settled = f.session
        .prepareEntry("owner", controller.signal)
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        .finally(() => {
          finished = true;
        });
      await f.world.promise;
      controller.abort();
      await nextTurn();
      assert.equal(finished, false);
      assert.equal(f.visible(), undefined);
      f.render.resolve();
      assert.notDeepEqual(await settled, { value: true });
      assert.deepEqual(f.events, ["construct", "world", "dispose", "restore"]);
      assert.equal(f.session.state().ready, false);
    } finally {
      await cleanup(f);
    }
  },
);

timed("actual plan admission refusal drains rendering before an installation exists", async () => {
  const f = fixture("admission");
  let finished = false;
  try {
    const settled = f.session
      .prepareEntry("owner")
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      )
      .finally(() => {
        finished = true;
      });
    await f.admitted.promise;
    await nextTurn();
    assert.equal(finished, false);
    assert.equal(f.contexts(), 0);
    f.render.reject(new Error("Later render refusal"));
    assert.deepEqual(await settled, { error: f.failure });
    assert.deepEqual(f.events, []);
    assert.equal(f.session.state().ready, false);
    assert.equal(f.visible(), undefined);
  } finally {
    await cleanup(f);
  }
});

void test.after(async () => {
  try {
    try {
      app.engineScope.dispose();
    } finally {
      await page.happyDOM.close();
    }
  } finally {
    for (const [name, descriptor] of borrowed) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
  }
});
