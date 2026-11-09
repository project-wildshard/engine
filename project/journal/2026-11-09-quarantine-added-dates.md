# Record the real quarantine introductions

State: prepared policy metadata, 2026-11-09.
Owner: codex-pinefix2; strict validation belongs to codex-mock.

The Opus CI review requires auditable 48-hour admission dates.
The old entries kept deadlines but did not record their addition time.
No new clock should begin when a file is edited, renamed or rebased.
I read the complete first-parent ancestry for test/quarantine.json.
For each remaining file I selected its first introducing commit.
The author and committer timestamps match for all three introductions.
addedAt is the original committer timestamp, normalized to UTC ISO.

test/cook-worker.test.ts
7d4d03d86e36bad38de64b121440532dbba822f9
addedAt 2026-11-08T12:05:02.000Z; deadline 2026-11-10T12:04:31.000Z

test/nalati-headless-population.test.ts
7d4d03d86e36bad38de64b121440532dbba822f9
addedAt 2026-11-08T12:05:02.000Z; deadline 2026-11-10T12:04:31.000Z

test/nalati-bot-taming.test.ts
e1117f8cc8f1747060d926d1e2e9eeb698a6605f
addedAt 2026-11-08T12:21:18.000Z; deadline 2026-11-10T12:20:11.000Z

test/nalati-discovery-verbs.test.ts
e1117f8cc8f1747060d926d1e2e9eeb698a6605f
addedAt 2026-11-08T12:21:18.000Z; deadline 2026-11-10T12:20:11.000Z

test/driftwood-long-session.test.ts
e1117f8cc8f1747060d926d1e2e9eeb698a6605f
addedAt 2026-11-08T12:21:18.000Z; deadline 2026-11-10T12:20:11.000Z

test/nalati-taming-verbs.test.ts
e1117f8cc8f1747060d926d1e2e9eeb698a6605f
addedAt 2026-11-08T12:21:18.000Z; deadline 2026-11-10T12:20:11.000Z

test/nalati-awareness-verbs.test.ts
e09a2343caabeb9cba5c361d05f0b89c9a79ede2
addedAt 2026-11-08T12:38:22.000Z; deadline 2026-11-10T12:37:14.000Z

test/physics-open-plots-headless.test.ts
e09a2343caabeb9cba5c361d05f0b89c9a79ede2
addedAt 2026-11-08T12:38:22.000Z; deadline 2026-11-10T12:37:14.000Z

test/standalone-grid.test.ts
e09a2343caabeb9cba5c361d05f0b89c9a79ede2
addedAt 2026-11-08T12:38:22.000Z; deadline 2026-11-10T12:37:14.000Z

Every original deadline, owner, file and reason is unchanged.
The first group has 47 hours 59 minutes 29 seconds remaining at admission.
The second group has 47 hours 58 minutes 53 seconds at admission.
The final group has 47 hours 58 minutes 52 seconds at admission.
No J200 extension has been requested, used or recorded.
No test is removed, renamed, skipped or made newly non-blocking.
All nine keep their original assertions and still execute/report in CI.
The runner may ignore addedAt until mock lands its strict admission parser.
Mock owns that runner, its declaration and its proof; I did not edit them.
Historical introduction hashes are receipts, not a new mutable timestamp.
Normal commit hooks apply; publication follows the current source batch.
The independently held broker is not authorized by this policy metadata.
