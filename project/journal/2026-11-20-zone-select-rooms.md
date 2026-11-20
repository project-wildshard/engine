# Zone Select on the rooms hosts (ZONE-SELECT-SERVED ZS14)

- Staging v0.1.54's title got 404 (no CORS) from `rooms-staging.wildshard.io/zone-select`: the door answered on
  loopback 8791, but Caddy had no route, so everything fell to `respond 404`. `harden-caddy.sh` now passes exactly
  `GET /zone-select` and `POST/OPTIONS /zone-select/enter` (press refused from foreign pages, `Cache-Control: no-store`).
  It reaches the box by `wildshard-apply <tag> harden` once a signed channel file names a tag carrying it.
- Surprise: the door built its catalogue URL from `PLACEMENT_URL`, which is the signed file on packs.wildshard.io, so it
  asked `packs.wildshard.io/api/catalogue` and logged `Catalogue HTTP 404` every 30 s; New was empty. `zoneCatalogueUrl`
  reads api.wildshard.io unless the placement source is a loopback dev API.
