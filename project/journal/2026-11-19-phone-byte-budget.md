# The phone byte budget, behind a device slot

meta IPHONE13-REAL-TEST IP30 (mini-iphone13-budget). A real iPhone 13 lost
Pine Hollow and Nine Dragon mid-load on staging v0.1.46 (QA71). Desktop
WebKit put their loading peaks at 1.5-1.6 GB with full GPU charge, and
the ledger explains only about 200 MB of Pine's 1 GB WebContent: most of
the transient is garbage the page has not collected yet.

`debug.phoneBudget` (device slot, phone tier only, off by default) turns
on one budget for decode and upload: optional audio decodes after control
on every shard (as Nine's manifest already asked), and WebKit's
collection hint runs between upload batches (each world-scene library,
each spawn-view fence batch, each loading step's release, the tile
settle) at most every 200 ms. Collision and the spawn cover are untouched.

Three locked pairs each, phone Low WebKit online, full GPU charge [K]:
Pine worst boot 1,602 -> 1,406 MB (median -258), control 7.1 -> 6.5 s;
Nine worst boot 1,507 -> 1,474 MB (median -46), control +0.1 s. Early
play stays below the control arm in every pair. The go line (-200 MB on
both) is not met, so it stays off; the iPhone 13 morning queue reads it
on the device.

Two things that did not work: two spawn-view lanes instead of four plus a
collection after every boot compile made Pine worse (-151 against -317),
and reading the slot on every call parsed the device save document each
time, which ate Nine's whole cut; the slot is read once.

A scene pool that fails to load now names its own error in `Missing scene
pool part` (an allocation failure, a read or a parse), not only the empty
lookup.
