# A look lamp lights with its panel

> Written by: Claude (opus-mossgate-m1), 2026-11-19

Meta MOSSGATE-ZONE MZ34, engine half (format 0.51.0 lets a look lamp name the `props.panels` id it follows). A lamp
naming a panel is dark until the page says that panel shows: the shardfile page registers its panel lookup on its scene
(`setLampPanels`, beside the follow lookup), and the lamp pool lights it only while the panel is visible. Its halo is left
out, as a following lamp's is, since a halo would stay lit. A grid cell's own look lamps are not drawn yet; the SDK half
(`lower.ts` writing `panel` on a part's lamps) waits for sharddev's format pin to reach 0.51.
