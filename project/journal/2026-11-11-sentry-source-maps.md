# Upload each page build's maps to Sentry before they are stripped

SENTRY-TRIAGE S5's CI half (meta plan, J238). Every frame in Sentry was
minified (`qh.setValue`), so the render crash in S2 could only be
worked from a guess. The client already reports release
`wildshard@<version>` with the build id as dist; nothing told Sentry
what those files were.

`scripts/sentry-maps.mjs dist --environment <env>` creates that
release, uploads the hidden maps of each folder that has them under its
own URL prefix (`~/b/c/entry-x.js` is the page's `/b/c/entry-x.js`),
and records a deploy. sentry-cli is pinned at 3.8.2. No token, no
upload, exit 0.

The plan named deploy.yml, but deploy.yml has not run in engine at all;
the pages that ship come from preview.yml (hourly) and the release
lane's hand builds of staging and production. So preview.yml runs it
between the build and the strip, `continue-on-error` so a Sentry outage
never holds a preview, and docs/server-release.md tells the release
lane to run it before its own strip. That lane needs the token on this
Mac (`~/.config/wildshard/sentry-auth-token`), which only Jake can make.
