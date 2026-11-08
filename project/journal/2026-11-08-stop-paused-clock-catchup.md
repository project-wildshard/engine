# Stop catch-up when a tick pauses its clock

CI42504740191on0c2e5f6fails dedicated-world with two fatal reports for
one broken tick. The cell catches the exception and pauses its clock,
but ServerClock's current catch-up loop ignores that pause and calls the
same broken tick again. Main's fatal handler masks duplicate exits, but
the clock contract is wrong and the exact-one-crash assertion catches it.

Keep that assertion. A real50ms event-loop stall in its existing socket
case makes the old implementation fail deterministically with three
reports instead of one. Check the existing running timer in the catch-up
condition; a pause now stops remaining steps immediately. Resume still
resets backlog as before. No simulation rate, catch-up cap, test clock,
timeout, population, assertion or quarantine changes.

The same complete world/transient/glob-cache cohort passes13/13in8.01s,
including the real100ms ordered IPC save tests and the50ms stall. Focused
lint and the complete layered compiler pass. This is a real pre-existing
production pause/catch-up defect exposed by timing, separate from the
transient test's parent-side durability race. Publish with the ordinary
full hook; exact CI/Ring1 green remain required, with no hosted rerun.
