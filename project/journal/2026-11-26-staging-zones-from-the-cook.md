# Staging and production read their zones from the cook (PV16)

> Written by: Claude

Preview borrowed staging's zone table (PV2). Staging and production now write their own before `build:game`: each pinned and
placed zone at its pinned shard version, under main's cook (`src/cook/game/cook-version.json`), serial the live release's plus one
(`zone-table.mjs own`). The build bakes it and goes zoneless like preview, and the check phase HEADs every cooked object before the
alias moves. Today's pins name no shard version (R2 layout RL12 adds them), so the step writes no table, says so, and the build
bakes its zones as before: the switch is the pins, not a flag.

A local staging-mode build with a table (`WS_CHANNEL=staging`, the release URL and key, `--mode staging`) passes the zoneless
check: no zone file and no zone server part; the server book keeps the road's row. The carry filter now keeps both rules for a
zoneless world page (no standalone server file, no zone file); before, the zone rule replaced the server one.
