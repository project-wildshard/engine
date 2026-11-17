# Author the hunt reaction

> Written by: Codex
> **State:** M2 source work, 2026-11-16–17. ONE-FORMAT, codex-te2e.

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

CC5a4: actual server controls exposed an unconnected body clock:
layer hunts decided but never advanced charges or checked contact.
Use the host's existing before/after-body callback phases, reading its
body cadence; keep the one host body step and native manager hooks.
Held, dead, stunned and paused bodies cannot deliver contact. The
actual damage event drains at its normal host phase boundary.

Plain admitted passive/skittish/neutral rows now react to actual damage;
aggressive and crowded-neutral controls really hurt the player. A
provoked neutral host restores and matches uninterrupted body, health,
brain memory and shared RNG. Three integration controls failed before
the body-clock connection; the five new controls pass with the original
inline-policy continuation tests.

CC5b1: aggressive layer pursuit now owns its home/return policy around
the existing PlatformBrain. It reads that controller's actual selected
target, cancels the existing strike while returning, then restores the
initial pursuit continuation and full health inside the authored home
stop. The real motor slows toward home so it can turn and brake into
that stop; there is no teleport or second body clock. Plain/native
callers without this explicit layer retain their original adapter.

Both real-server return tests fail with this binding removed, then
pass: a player beyond45m provokes return, arrival heals, re-entry starts
a fresh pursuit, and a mid-return snapshot resumes body/controller/RNG
exactly. All35cases/fivefiles and defining types/lint pass.

CC5b2: authored territory now bounds both pursuit acquisition and the
native body's wanted displacement. The constraint includes native
impulses, composes the previous world constraint, and restores that
previous owner when its scope ends. Returning still uses the same
controller and home policy. Two real5m boundary controls fail before
the fix; the normal pursuit entry and constraint-lifetime controls pass
with the existing layer and45m return controls (20cases/twofiles).
