# /health says what the workers hold

ROAD-RESIDENT RR2. RR1 made every cell resident from the boot, but
`/health` only said how many cells the door's table names, not what the
workers actually opened, nor whether each worker's road came up. With
crossing the default now, staging's check (RR7) needs to read "the road
is resident" without a shell on the box.

Each worker's `booted` news now carries `resident`: its open cells,
whether its road is open, and the strips that road stands on (zero
when no road opened, so a grid pack with no strips reads 0). A `placed`
answer carries it too, so a placement keeps the count true. The door
keeps one row per booted worker, drops it when the worker ends, and
`health()` sums them as `resident: { cells, roads, strips }`.

The field is optional on the wire: test fakes that say a bare `booted`
read as holding nothing.

Tests in `dedicated-resident.test.ts`: a two-worker bench over three
cells says 3 cells, 2 roads and some strips with crossing on, and
3 / 0 / 0 with it off. A worker that never says `booted` leaves
`World.open` pending, and `main.ts` only listens after it resolves.
