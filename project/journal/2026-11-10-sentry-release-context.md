# Name Sentry releases by version and send browser context

The client side of SENTRY-TRIAGE S5 (meta plan, J238). Every Sentry
event carried a singleplayer build id as its release, so no event said
which engine version it came from, and with no default integrations
there were no browser, OS, device or URL tags at all.

The release is now the app slug at package.json's version
(wildshard@0.1.7), read from the same __ENGINE_RELEASE__ define the
title uses; the build id moves to dist and stays the build tag. Only
httpContext (URL and user agent) and dedupe are added: still no global
handlers, breadcrumbs, tracing or replay. beforeSend keeps just the
User-Agent header, so no referrer leaves the page.

Source-map upload is the other half and waits for two things: Jake's
org token in SENTRY_AUTH_TOKEN, and a CI step that lands after the
v0.1.6 cut, so the release train is not changed mid-cut.
