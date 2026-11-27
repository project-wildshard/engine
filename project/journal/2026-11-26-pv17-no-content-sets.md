# Staging and production publish no content set (fix preview PV17)

> Written by: Claude (lane opus-cookktx2), 2026-11-26.

The release train's staging leg drops `--content`, and page-release
refuses it for staging and production: their zones come from the cook
(PV16), so neither writes a `content/<set>/` key. Without a set the
build joins `dist-content/` back into the page, which today still holds
every zone; that join now passes `--no-shard-content` for those two
channels and refuses any shard content (S1 to S7), so no release quietly
puts about 1.8 GB of zones back on the page Worker (J276). Engine art
still joins. Explore keeps its set until PV15 decides it.

This lands after PV16 makes staging and production builds zone-free; on
today's main their builds would refuse.
