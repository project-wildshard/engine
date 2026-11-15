# Watch observer ids

`Game.watchFrames` gave every observer the one system id `harness.walk`. The dev hook holds several observers at once:
its ground sweep from boot (hook v3), then one per part with lamps or water. The second registration threw
"Duplicate system id", so in `wildshard watch` the first part with a lamp never drew, the page never framed a revision,
and sharddev's `check:watch-build` timed out after 180 s on every push once engine v0.1.21's devserver client shipped.

Each observer now takes `harness.walk.<n>`. The boot smoke's observer probe matches the prefix. sdk bridges 0.1.21's
client in its watch page until its engine pin carries this (SHARD-SOURCE AP16, opus-ap16b).
