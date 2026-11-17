# Death triggers can name a spawn

> Written by: Codex
> State: implemented, 2026-11-16.

Honeyknoll QA mini #70 / F43: take Jake's allowed exact-spawn option.
A declared death trigger's `tag` can match the dying actor's exact id,
or any existing actor tag. Thus `hive-bear` selects one authored bear,
while `creature.bear` keeps selecting that species/kind. No wire/schema
or publication dependency is introduced. ONE-FORMAT OF28/OF29 own the
population/kill-credit seam; neither has another specific claim here.

The native failing-first test kills a real body, checks exact id and
all its tags, rejects an unrelated id, and proves conditional credit
remains private to the eligible player. Quest-player controls pass.
