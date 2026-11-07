J189/J190: the first engine-backed release starts progress epoch 1, with a
sibling localStorage prefix and an independent IndexedDB database. Settings,
graphics, controls and stable device identity survive. Progress and recovery
state do not carry, and an old portable save cannot undo the wipe.

The completion document is written last, so a phone retries a denied carry
without reloading and never resets successful new progress on later boots.
Real IndexedDB proofs pass on Chromium and WebKit, including reload, identity
carry, old-file refusal before stopping a server, and old-reader isolation.
Legacy fixture tests explicitly retain epoch zero. Snapshot format stays 3.

The previously unhomed wire shop test now runs against engine's pinned
Driftwood product instead of importing shard author source.

Browser fixture writers now seed epoch 1 alongside the updated readers.
The standalone real-IDB proof has an explicit .proof.mjs name, keeping its
node:test runner out of Vitest discovery and all commit/push test hooks.

The final outer-edge check runs the real page-to-worker reward reconciliation
against old-epoch reward documents: no reward or finish is copied.
