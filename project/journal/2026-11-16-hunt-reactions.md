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
