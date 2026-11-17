# Author the hunt reaction

> Written by: Codex
> **State:** M2 source work, 2026-11-16. ONE-FORMAT, codex-te2e.

CC5a1: layer hunts discarded the reaction after reducing it to an
aggression boolean. A passive animal with stalk tuning could hunt and
charge, and a stale charge could still contact the player. Pass the
admitted reaction through the existing hunt species port. Passive
transitions and hit notifications flee; charge advancement and contact
refuse damage. Legacy callers omit the field and keep the same law and
memory codec.

Five real-body/cadence controls cover close contact, stalk tuning,
alert expiry, a restored charge and legacy damage. Three passive cases
failed before the fix; both omitted-reaction controls already passed.
The normal server layer and native cadence controls pass alongside them.

CC5a2: skittish hunts flee immediately inside their admitted notice
radius and after a damage notification. The radius gates their senses
and panic trigger; a larger stalk or old sight radius cannot pull them
outside that authored range. Without an explicit senses layer, use the
existing authored hunting sight range. Both stalk/no-stalk controls
failed before the change; passive and omitted-reaction controls remain.

CC5a3: neutral animals may observe without stalking or charging. A
real damage notification or entry inside the authored panic distance
permits retaliation. Only neutral hunts add a provoked flag to their
owned memory; generic save/restore keeps that flag, while the original
native codec fields and draw order stay unchanged. The flag clears
when a stalk gives up or a fleeing animal reaches safety. Red-first
controls cover both tuning shapes, both provocations and continuation.
