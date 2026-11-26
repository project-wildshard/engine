# Production flip token (meta QA 11-25 row 135)

- server-release.yml's production-pointers job now reads PRODUCTION_FLIP_TOKEN, which api-server v0.38.0 takes on
  POST /api/channels/production/flip and refuses everywhere else; the full ADMIN_TOKEN leaves the production
  environment, so no GitHub secret holds it.
- test/server-release-ci.test.ts now fails on any workflow naming secrets.ADMIN_TOKEN and on any second reader of the
  flip token.
- Guard for the slip (coordinator, 11-26): ADMIN_TOKEN left the production environment while release/v0.1.97 still
  read it, so v0.1.97's production-pointers job goes red after its publish (opus-rel97 flips by hand; v0.1.98 carries
  742b8458c). src/scripts/server-release/secret-remove.mjs is now the way an engine secret leaves GitHub: it refuses
  while main or any release branch or tag newer than production's build reads secrets.<NAME>. Its --check on the live
  repo names release/v0.1.97 for ADMIN_TOKEN, so it would have refused. Meta's secret-delete-guard hook refuses a
  bare gh secret delete on engine.
