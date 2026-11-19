# Pin the Template at revision 10

Template rev 10 (cc1fcd31) is the scene-API Template from sdk v0.4.10,
prepared on v0.1.46's client and live on staging (meta SHARD-SOURCE AP36c).
Only the template rows move (Driftwood r5 and Nine r3 stay). Rev 10 ships
the chest's setsFlag itself, its blob backs off between strikes (the journey
now follows it), and the released Template save is refused on rev 10 as on 9.

Run `44437207022` replayed the new pin at 240 ticks and ended at
`0f450daf2c1f1f53` on Linux x64. The seven other rows still matched.
A local Darwin ARM64 replay produced the same final digest prefix.
Refresh Template's four links on both platforms from that replay. The
hosted comparison checks every full Linux x64 link on the next run.
