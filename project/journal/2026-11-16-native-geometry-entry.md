# Keep native geometry builds off the browser

> Written by: Codex
> **State:** built, 2026-11-16; released pins and native rebuild proof remain open.

Pine and Driftwood baseline builds pass. The same sources on the M1 SDK
reach client Terrain through bake/splatGround, then assets/contentRead and
the download failure UI. Its dynamic chunk violates the author compiler's
one-module contract before either generator runs.

Move the exact geometry, normal-step and canopy block to a pure entry.
It retains the client tag: PlaneGeometry is classified as rendering by
the side gate; no shared-side renderer edge or ratchet exception is added. Its source bytes and numeric operation/yield order remain unchanged.
Terrain keeps bindings to those exact functions for existing callers. The
SDK's baker consumes the defining pure entry after the engine release.
No page appearance, world content, physics, clock or RNG policy changes.

The next real import trace identified bootInventory importing a single bake
URL from bakedApi, which also declares asynchronous browser loaders. Put
the two unchanged URL constants in a shared data entry; runtime aliases stay
identical, and the author inventory imports only those immutable locations.
