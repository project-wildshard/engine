# Align the staging cook during the signed switch

Build-max C7. On v0.1.66 the room timer switched from serial 131 to
132 while the cook still published indexes for v0.1.65. Pine r10
activation retried against an index for the wrong engine build.

The staging check follows the verified signed build before placement
readiness and room-health polling. The existing cook command reads
back its tag, build and health. Go-live checks it again before aliasing.
