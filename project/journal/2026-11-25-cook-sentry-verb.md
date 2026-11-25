# wildshard-config cook-sentry (opus-rel86, MMO-OBSERVABILITY OB11)

- The cook's alarms (a full pack store, a refused activation; QA 11-24 rows 62 and 63) reach Sentry only when cook.env names SENTRY_DSN, and the agents' allowlist refuses secrets in `set`. One verb now takes exactly one Sentry ingest DSN on stdin, writes it to the root-only cook.env, rebuilds the cook step and restores the old file if /health fails. It never prints the DSN.
- It reaches the box with the next release's harden (FR-A11 applies that itself when scripts/vps changed).
- `wildshard-config cook-sentry --test` sends one warning event to that project from the box (environment cook, tag proof=ob11) and prints only its event id, which is OB11's proof.
