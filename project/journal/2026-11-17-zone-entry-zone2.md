# 2026-11-17 zone entry, the Nalati card again (opus-zone2)

## Packed attachments bind before they join the rig (opus-zone2, 2026-11-17 ~06:00 Cancun)

Staging v0.1.34 carries `a8239075` (fur shells bind first), but Nalati's
gate entry still showed the error card in the pair proof and in a probe:
`grid.runtime.nalati-grasslands.animals` threw "reading 'bones'" in the
cell clip's `childadded` watch, `render` threw "reading 'update'", and the
new Game stopped at frame 9 with 0 draw calls (a flat-coloured screen
when the card had not opened yet). The second path was a packed look's
worn attachments (`speciesBook.ts` `packedLooks`): each self-lit skinned
mesh was added to the rig, then bound. `wearAttachment` binds first;
`species-attachment-bind.test.ts` is red on the old order. No other
add-before-bind site in `src/`.
