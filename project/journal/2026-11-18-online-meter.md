# The online meter: measure.mjs --online (MEMORY-STRUCTURE STR1, J415)

J415 judges J410's lines on the online boot, and every reading so far was a standalone boot carrying the in-page server
worker. `measure.mjs --online --dist=<built client folder> --chunk=<slug>` now opens `online-rig.mjs`'s signed
dedicated server on loopback for that folder (memory saves, one cell, one world worker, ephemeral ports, a fresh
fixture key) and stamps the page with its world (`__WS_WORLD__` = {release, key}, by init script, as
`src/e2e/t1/online-fixtures.ts` does). The boot answers the Name prompt as a player would. `--online=pair` alternates
online and standalone boots of the same build on the same page origin, the order flipped each round; `--round=k` lets a
shell loop take one pair per command, each inside the measure lock.

Adopted from mini-pinemem6's scratch driver (meta `engine-memory/pine-online-2026-11-18.md`): every `new Worker` URL is
recorded by an init script, an online run that starts `serverWorker-*.js` is refused, and so is a standalone run that
starts none. Each run carries `boot` and `workers`; the JSON and the summary name the boot (`online`, `standalone`, or
`online+standalone` for a pair). `ratchet.mjs` (`footprintBoot`) and `phone-fit.mjs` refuse runs that mix boots, or a
baseline of the other boot, as they do instruments; a run from before STR1 counts as `standalone`.

## Reading (engine `d0fd6e62` build, pins as main names them, Mac mini, load 6 to 15)

6 locked pairs per zone, phone Low, instrument `minimal`, online minus standalone, MB [K]:

| Zone | Settled WC + GPU | Settled WC | Peak WC | Server worker online / standalone |
|---|---|---|---|---|
| Template | −95 (−120 to −83, 6 of 6) | −98 | −205 (6 of 6) | 0 of 6 / 6 of 6 |
| Pine Hollow | −132 (−189 to −60, 6 of 6) | −139 | −156 (5 of 6) | 0 of 6 / 6 of 6 |

Structprobe's worker cost was 99 (Template) and 139 MB (Pine). EM11 on the online boot: Template playing 0.487 (upper
0.567), loading 0.617 (0.752); Pine playing 0.830 (1.004), loading 1.214 (1.511).
