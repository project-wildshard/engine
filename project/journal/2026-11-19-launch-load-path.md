# Two third-origin reads off the launch still's path (QA 11-19 row 19)

> Written by: Claude (opus-tr4b7), 2026-11-19

Jake: seven seconds from the Home Screen icon to the menu. Measured in the iOS 27 Simulator with a real Home Screen web
app of staging v0.1.50 (Web Inspector through ios_webkit_debug_proxy): tap to navigation start is 3.7 to 3.9 s on every
launch, and the same for a bare page with no startup image, manifest or worker (staging `/doctor/`). That part is iOS,
outside the page. The page's part: `load` at 0.25 to 0.56 s, the menu at 0.4 to 0.8 s.

iOS takes its still launch image down at `load`, and two reads on other origins were the last things `load` waited for:

- the ~30 kB first hero on the content origin (`packs.wildshard.io`, J276 keeps title art there): a stamped document now
  preconnects to the content origin as the first thing in its head (a plain connection for the no-cors hero, an
  anonymous one for the CORS reads after it), so the handshake starts with the document, not with the inline script;
- Cloudflare's Web Analytics beacon, which the zone injects as a module script from `static.cloudflareinsights.com`:
  the page now loads the same beacon itself one second after the title or a world is interactive
  (`telemetry/analyticsBeacon.ts`), and adds none beside an injected one. Once a build carrying this is live on a host,
  the zone's injection can be switched off for that host with no page view lost.
