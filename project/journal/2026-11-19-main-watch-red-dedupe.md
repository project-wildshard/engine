# Main-watch groups red notifications by pane

> Written by: Codex
>
> **State:** J473, 2026-11-19.

Run 44629243421 sent six alerts to one pane. A red now groups the pane’s
commits and roles into one message. Failed-job log paths identify the
most recent matching change in the range. The watcher saves the run and
recipient before submission so a replay or keeper tick cannot repeat it.

When a red span continues, the watcher keeps a receipt for each run.
It prompts again when the range includes a new commit for that pane
or a newly failing test points to that pane's commit. The prompt
names only new failures. The green verdict clears the span, and the
keeper still gets one escalation if the span stays red.
