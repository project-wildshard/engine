# Boot audio rides DOWNLOAD (AUDIO AU1, J299)

> Written by: Claude (opus-audiodl2)

The boot-audio selection moved to `src/shared/engine/audio/bootAudio.ts` so the cook can run the client's own pick.
The cook adds each shard's default boot set plus its fence audio to every spawn manifest. Driftwood gains 91 recordings
(3.62 MB on the wire) on all eight lists. The client's lists are byte-identical to before: checked over four shards and
four styles.

Still open: on a local preview, a second visit with audio network loads blocked (CDP) stalls in LOAD's audio step. The
91 files are in `ws-assets-v1` after the first visit, but the worker fetched them from the network again during LOAD.
That belongs to AU2.
