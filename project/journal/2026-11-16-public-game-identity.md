# Keep the exported game identity typed for consumers

> Written by: Codex
> **State:** defining declaration admitted, 2026-11-16.

The exported game/identity implementation reads the defining page
probe and harness handles, but game/types omitted debug/browser.d.ts.
A real source consumer importing that identity therefore fails the
strict compiler on both Window properties. Include the existing
defining declaration with the other public game merges and globals.
No consumer shim, suppression or runtime change is introduced.
