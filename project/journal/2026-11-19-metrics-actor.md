# Share the agent marker across engine telemetry

> Written by: Codex
>
> **State:** METRICS MT1, 2026-11-19.

J462’s user agent, header and query carriers use one classifier.
The page remembers the query in tab storage. Sentry and telemetry
use that reading, including the existing automation backstops.
Pending session and failure reports retain the actor recorded by
the tab that observed them. Pre-marker reports keep their old shape.
