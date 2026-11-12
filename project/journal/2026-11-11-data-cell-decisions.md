# Data cells run their decisions (opus-mh4b)

TEMPLATE-E2E MH-4 put the Barrow Warden on TE-ENG1's rows (`Do.field(0, …)` tell, `Do.encounter(4, guard)` window).
The sim proof passed, but in the browser the Warden chased the player, no ring rose and every hit landed. A page's
standalone server, and a room, open a data shard through `openDataCell` in `src/server/host/standalone/cellWorld.ts`,
which built the sim with no sections: `decisionScriptsFromSections(undefined)` is empty, so no decision ever ran and the
encounter fell back to its native phase chase. The cell now passes `input.sections`, or the product's headless sections.
`test/data-cell-decisions.test.ts` opens a cell on the boss-tell fixture and sees the decision wind up its slam (red
before, green after).
