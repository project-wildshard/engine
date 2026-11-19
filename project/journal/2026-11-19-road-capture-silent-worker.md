# Road capture: a silent worker no longer holds the road

> Written by: Claude (opus-tr4b6). TEMPLATE-E2E TR-4b.

Hosted T1 B, E and I sat 60 s on a second boot at `wait:Road tile capture worker` (run 44566402755): the capture
worker took a job and never answered, on hosted runners only. The worker now has an 8 s reply deadline while it holds a
job (re-armed at each answer). Past it the worker retires and its jobs are captured on the page through the `refused`
path, in order; later sources take the page path and a late reply is ignored.
