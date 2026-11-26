# Production flip token (meta QA 11-25 row 135)

- server-release.yml's production-pointers job now reads PRODUCTION_FLIP_TOKEN, which api-server v0.38.0 takes on
  POST /api/channels/production/flip and refuses everywhere else; the full ADMIN_TOKEN leaves the production
  environment, so no GitHub secret holds it.
- test/server-release-ci.test.ts now fails on any workflow naming secrets.ADMIN_TOKEN and on any second reader of the
  flip token.
