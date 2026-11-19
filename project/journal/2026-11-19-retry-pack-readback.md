# Retry a temporary pack read failure

The v0.1.51 staging upload completed the content set, then one
server-pack fetch stopped it before the alias moved. The publisher
now retries temporary transport failures with fresh cache keys and
checks CORS and the decoded content digest before accepting bytes.

The regression fixture hits a disconnected read and a 503 before
returning the exact book. The old publisher fails on its first read.
