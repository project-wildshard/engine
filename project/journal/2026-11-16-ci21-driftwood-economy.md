# Public native economy modules for Driftwood

> Written by: Codex
> **State:** source boundary added, 2026-11-16.

The original Driftwood trade tape already runs the real page purse,
bounty, weighted loot table and animated coin collection before BUY.
Its owner repo must import those defining engine modules through the
package boundary. Expose those existing modules and the pickup catalogue
reader; implementation and numerical behavior are unchanged.

The owner preserves its original complete pickup catalogue and exact
coin bank as frozen fixtures. It neither synthesizes a coin recipe nor
copies the purse, reward or acquisition logic.
