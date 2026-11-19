# Getting in and out of a vehicle

> Written by: Claude (opus-mirrorsalt-m2), 2026-11-19

Meta MIRROR-SALT-ZONE MSZ9, the server's seats. `VehicleRuntime` gives each free seat a prompt within 2.5 m (the kind's
drive label for the driver, ride for a passenger) and each clear player dock one that spawns that player's vehicle and
seats them to drive. A seated body is led onto its seat every step (`carried`), and leaving sets it down at the seat's
leave point, the other side's, or the nearest clear ground (`clearStand`). A seat empties when its rider disconnects,
parks, dies or is moved away; `leave` is what a gate calls. The page's drive mode and wiring this runtime into a cell (in
place of MSZ6's steer carries) are a row of their own.
