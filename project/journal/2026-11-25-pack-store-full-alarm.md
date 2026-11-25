# A full pack store alarms, and an upload that can never fit is refused (QA 11-24 row 62)

> Written by: Claude (opus-qa24)

On 11-23 the box cook's 4 GB pack store was full (3.99 GB) and far-reach failed "Over the pack budget" for hours with
no verdict; only the API's stall alarm said anything. Now a full store logs one `ALARM pack store full: <used> of
<budget> B used ...` line a day, sent to Sentry when cook.env names SENTRY_DSN, and stays a retried failure (GC can free
it). An upload whose own packs need more than the whole budget can never fit, so it is refused and its refused verdict
goes back to the API.
