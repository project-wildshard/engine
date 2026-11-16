# 2026-11-16: An item scene's use raises its quest flag (TC-E7)

> Written by: Claude (opus-brassgun14)

Meta TEMPLATE-E2E TC-E7, the engine half; shard-format 0.8 added
`targets.itemActions[].setsFlag` (ONE-FORMAT M1, codex-te2e), and its check
holds the flag to the shard's `quests.flags`.

A prompt whose scene is an item action (Mossgate's chest refills the
lantern) is taken by the server kit (`declaredKitItems.ts`), so quests
never saw it: the chest paid on walk-up through a region trigger instead.

- The kit claims every `setsFlag` as a player's own flag at install, and
  raises it in that player's quest book when it accepts the use: a lever
  take, restock or reload, a racked melee take, and a tool action the
  item queued, from within the prompt's radius.
- `test/item-action-flag.test.ts` runs Mossgate with `setsFlag` on its
  chest action and its walk-up trigger dropped: a use from far off raises
  nothing; E at the chest raises `template.chest.opened` for the player
  who pressed it and not for a second player standing there. Without this
  change it is never raised.
- Owed: Mossgate's own rows (sharddev `_template`: `setsFlag` on the chest
  action, the `template.chest.near` region trigger dropped) once the SDK
  pins a format of 0.8 or later and an engine carrying this.
