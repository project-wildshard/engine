# The cook reads staging heads (MS2.4)

> Written by: Claude (opus-ms24), 2026-11-13

SA17's walk-in needs a new author's shard cooked into packs. `upload --channel staging` moves only the staging pointer
(J275 tables), and the cook worker listed only `live` (production) and `preview` heads, so it would never have cooked
one. `apiSource` now reads `channels.staging.raw` from `/api/catalogue` as a `staging` head, and `serve`'s boot list
cooks live, preview and staging. Test: `test/cook-api-source.test.ts`. The notify path is unchanged (SP6 replaces it); a
restart of `wildshard-cook` is the interim trigger. The box opening a placed cell from a cook index, and the page loading
its content, are still rows (meta SHARD-AUTHORING SA17 checklist).
