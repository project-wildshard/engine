# Template programs 404 (opus-tpl404, TEMPLATE-E2E TE-ENG12)

Staging v0.1.13 booted the Template (Mossgate rev 2) with one console 404: `/programs/_template.json`. The placement
keeps its authored slug, `_template`, but the pin publishes the recorded entry programs under the product slug,
`/programs/template.json` (staging serves it, 200). `bakedEntryPrograms` built the URL from the authored slug.

Fix: `entryProgramsURL` in `spawnDownload.ts` names the file by `bareSlug`, and `packBase` matches a pack home's
`shards` under either spelling (a bake lists stored cooks by product slug; caught by the `claude -p` review). Test
`test/entry-programs-url.test.ts`. Proof: local production build, headless `?chunk=_template` and `?chunk=pine-hollow`
both boot with 0 console errors; the Template now asks for `/programs/template.json`, so its early programs link too.
