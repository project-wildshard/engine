# rooms-staging answers /up (opus-uptime)

- The architecture audit (meta `docs/architecture/vps.md`) found
  `rooms-staging.wildshard.io/up` answered 404: harden-caddy.sh wrote `/up`
  on the production site only. Nothing outside the box could watch staging.
- Both sites now render the same `/up` block (bare 200 while that channel's
  `/health` answers, 503 otherwise, no body); `/health` stays tailnet-only
  (D7). Sentry uptime monitors (J252: alerts inside Sentry only) watch both.
- `harden-caddy.sh --print <addresses>` renders the file and stops before any
  root step, so `test/vps-caddy.test.ts` checks the exact text it writes.
- Applied with `wildshard-apply <staging tag> harden`; Caddy has `admin off`,
  so the config change is a Caddy restart (game servers untouched).
