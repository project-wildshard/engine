# The cook stops retrying a refused activation every 45 s (QA 11-24 row 63a)

> Written by: Claude (opus-qa24)

Two staging re-uploads of unplaced open plots (thin ice, desert ruin) asked to be placed, but those slugs hold no cell
on any grid, so the game answered "Placement does not publish the upload hash" on every sweep for two days and nothing
alarmed. The API side (api-server) now sends such a notice as unplaced. Here, the cook's activation delivery backs a
notice the game keeps refusing off to an hourly retry after an hour and raises one ALARM line a day, sent to Sentry
when cook.env names SENTRY_DSN (environment `cook`). A notice the API stops listing forgets its clock.
