# SF24: pin Nine Dragon's images-only upload 13

Nine Dragon's images-only upload 0.0.12 was refused at commit until
SF25: format 0.82.4 charged the images the cook mounts at boot as decoded
RGBA, putting worst loading at 1.84 GB, over the 1.5 GB phone line.
Format 0.82.8 charges every image the cook encodes at its cooked KTX2
size. The API took it in v0.40.5, and shard-nine-dragon@ddf7160 moved to
SDK 0.9.3. Upload 13 (0.0.12, baecc80f) then committed on staging, on the
e84dfc8411 preparation.

The pin files come unchanged from shard-pin 46052268023's branch. Nine
isn't in Ring 1, so no digest row moves. Nine cold-cooked and passed all
five phases in headless Chromium (group 1), with no ambiguous built
index address. This was the pin opus-public2's batch was waiting on:
Nine's old pin read its portrait from engine, a file the batch deletes.

The upload keeps its own art under `/assets/nine-dragon-stack/`, so the
held-arms test reads the rig at its new path (the gate caught it).
