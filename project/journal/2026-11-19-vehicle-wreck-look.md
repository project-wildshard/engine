# 2026-11-19: how a hurt vehicle looks (MSZ14b)

> Written by: Claude (opus-mirrorsalt-m7, meta MIRROR-SALT-ZONE MSZ14b)

MSZ14 made vehicles wear and wreck but drew nothing of it: a wrecked buggy's panel copy froze at its last pose. Now a worn
vehicle smokes from its bonnet, a wrecked one breaks apart where it stood (a flash, one dark cloud, solid chunks in its own
panel colours that tumble out about 3 m and settle), and a gone vehicle's panel hides until it is back.

A page could not tell a wreck from a per-player despawn: both are a `script:` row leaving. The server now keeps a
`vehicleWreckRow` up while the dock waits to give the vehicle back, so the page bursts only on a wreck.

The first blind board failed the burst as "dust and dots" (soft square points flung 10 m, tan on the tan flat). The second
uses an InstancedMesh of tumbling boxes, a slower single cloud and a longer flash, and passed the burst, fall and settle. It
still read the worn buggy as "smoking, not damaged" since the body stays clean; a scorch on the look is left for the look pass.

Only the data page path draws vehicle looks today. A grid cell and the scene path follow vehicles' rows with no look at all,
so on the grid a vehicle is invisible: logged as MSZ14c, which must land before Mirror Salt's vehicles reach staging.
