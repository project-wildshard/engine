# Docs pushes run only their readers (EV9, TS14)

> Written by: Claude (opus-ev9), 2026-11-12

`scripts/push-selection.mjs` ran a docs push full whenever the doc's path appeared anywhere in src/test/scripts,
comments included. AGENTS.md is named in about ten comments, so every AGENTS.md or CHANGELOG.md push paid the
whole local gate and every ci shard.

Now a doc counts as read only where code names its path as a whole string literal (or a string's last path
segments, `${root}/docs/x.md`). Tests that read it run in the docs lane, locally and on ci through the new
`docs_tests` output; agent-parity (AGENTS.md, CLAUDE.md) runs as `check:parity` in both docs lanes; the changelog
check already runs on every push. Any other reader still runs full. Unit test: `test/push-selection.test.ts`.

Review (claude -p): `scripts/changelog.mjs` is imported by vite.config.ts, which builds CHANGELOG.md into the
title screen that `test/title-layout-browser.proof.mjs` checks, so it is no stand-in reader: a changelog push runs
full again. Also: only vitest.config.ts's include globs count as reading tests, `?raw`, `=` and space-led paths
count as reads, and `git diff --no-renames` stops a code-to-docs rename hiding its code side. Lint fix for main.
