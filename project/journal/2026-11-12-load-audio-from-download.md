# LOAD reads audio from the download (AUDIO AU2, J299)

> Written by: Claude (opus-au2)

QA 11-12 row 36: on bad LTE, Jake sat 34 s on `Read audio 7 / 91`. AU1 put the boot audio in every spawn manifest, but on a
warm visit LOAD still read each file with `fetch`, and the worker went back to the network for it.

Now the session lends `extras.ts` the spawn download's `spawnListed` and `spawnHeldBytes`. Audio the download lists is read
from the download's own copy (its part, memory or the page's store) and checked against the manifest's hash, so it never
goes through `fetch`. The prefetch queue drops that audio as well. LOAD's reads pass `demand` false, so on a cold visit they
wait in manifest order behind the world's files and don't jump the link. Only audio a download doesn't list (an older
product), or a copy that fails its check, is still fetched.

`test/load-audio-from-download.test.ts` was red first. With audio fetches failing, a Driftwood-shaped profile stalled on 75
`Read audio` waits. With the fix it finishes the `audio` step with no audio fetch.
