# Keep the herdless page proof on the keeper fixture

> Written by: Codex (lane codex-ms)

Sunscar Dunes rev 6 drops the legacy client population row. The herdless-page test now takes its decisions and roster from the same frozen keeper fixture as its server. It still checks that the page prepares the matching roster, spawns no bodies and subscribes to no deaths. The shipped Dunes test continues to exercise rev 6's declared spawns directly.
