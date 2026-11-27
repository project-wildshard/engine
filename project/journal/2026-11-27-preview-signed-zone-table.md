# Preview deploys with staging's signed zone table

Preview's workflow passed the grid catalogue to the release command but
left the cook table out. It now verifies staging's signed publication
and passes its table to build and check, so the page reads zone content
from the cook and checks those objects before switching the alias.

The workflow regression fails against the old wiring. PV13 still
checks the same job for content-set flags and R2 writes.
