# Sentry maps name a token that cannot make a release

> Written by: Claude (opus-ship), 2026-11-28.

v0.1.101's staging build ran `sentry-maps.mjs`, and `sentry-cli releases new` answered a bare 403. The build then
stripped the maps and shipped without them. The token at `~/.config/wildshard/sentry-auth-token` is a read-only user
token: alerts, event, member, org, project and team read. A release needs `project:releases`, or `org:ci` on an
organization token. `sentry-maps.mjs` now reads the token's scopes from `GET /api/0/` before it calls sentry-cli. A token
that lacks both scopes is refused with its source and its scopes; the token itself is never printed. Guard: the PV28 test
in `test/sentry-maps.test.ts`. The maps upload once the token is replaced (meta fix-preview PV28, waiting on Jake).
