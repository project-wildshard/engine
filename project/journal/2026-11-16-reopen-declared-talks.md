# Closing a talk leaves its NPC available

> Written by: Codex
> State: implemented, 2026-11-16.

Honeyknoll QA mini #71 / F44: null next still closes a conversation,
but the prompt remains available. Interacting with a closed talk sends
an explicit start action. The server checks reach, resets that player's
closed dialogue to its authored start, and publishes the node before
the client opens it. A terminal node uses the same return path.

This recovers existing saved null states and lets conditional choices
offer a later turn-in without automatically reopening the box. It does
not change native dialogue completion, rerun accept effects, or reset
quest flags. Flags still prevent repeated turn-in rewards.

ONE-FORMAT OF17 is the declared section/primitive seam. Red-first page
and native tests cover the missing prompt/start route, saved closed
states, distant refusal, accept/Leave/return/turn-in and once-only pay.
Quest-player and grid talk controls pass. A proof tape reopens on its
named talk action through the same server claim. No format schema changes.
