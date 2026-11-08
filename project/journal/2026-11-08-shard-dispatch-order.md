# Dispatch the heaviest planned work first

The new exact matrix packed durations into bins but still inherited
Vitest's cold default file order. That could leave small wrapper files
with expensive native imports until the tail, unlike the modeled LPT
schedule. The CI sequencer now dispatches the exact plan's descending
cost order inside each phase and refuses an unplanned file.

It does not activate the old lifted sequencer's product preflight or
cohort skipping. All files retain the exact configured include/exclude
union and isolated forks. Native phases still have one worker and
ordinary phases two. This is a scheduling correction, not a larger
budget, timeout change, or heavy simulation test edit.

A real two-file Vitest run dispatches ab under the cold default and ba
under the opaque plan's requested order. A third unplanned file is
refused by the actual runner. The complete CLI proof takes one second
and runs only in CI's planning job, outside local hook discovery.
