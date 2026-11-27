# SF24: pins move to the images-only uploads

- opus-pins: Driftwood 14 (0.0.13), Far Reach 10 (0.0.10), Dunes 10 (0.0.9) and 15 open plots at
  upload 4 or 5 (0.0.4) now pin their images-only staging uploads with a shard version. Ring 1
  digests are unchanged (images-only moves no server step).
- Two tests named old mount paths: Driftwood's own island music set and its arms rig now live
  under /assets/driftwood-isle/, and a release row carries the pin's shardVersion (PV2).
- Left: Nine stays on 0.0.11 (its upload is over the armed 1.5 GB line, SF25); Nalati and Pine
  follow once their publishes pass; desert-ruin and thin-ice are hidden in the catalogue, so the
  staging channel omits them and pin-shard refuses their 0.0.4 uploads (live on preview).
- Proof: Driftwood booted all five phases in Chromium (Explorer 66 thumbnails) and Starfall in
  muted headless WebKit (Explorer 2 thumbnails, 2.6 s), with no ambiguous built index address;
  192 pin-reading test files pass.
- The push gate then named three more audio tests that read the old layout: Driftwood's engine
  music is now the title and three stings (4 files, no island), and an images-only zone mounts
  its own audio under /assets/<slug>/sfx/, which the download tests' audio patterns now accept.
  vps-agent failed once under the gate's load and passes alone.
- vps-agent's cook wrapper ran PATH's node; inside the push gate that is gate-bin/node, which
  needs WS_GATE_NODE, and the test's spawn env drops it, so three cases failed only in the
  gate. The wrapper now execs the test's own Node (process.execPath).
