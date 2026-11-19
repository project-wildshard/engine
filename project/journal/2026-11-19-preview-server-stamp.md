# Preview opts in to the browser server

STR7 and J414 give the in-page game server an explicit document
stamp. The signed world always wins. An unstamped client cannot
start a worker and tells an author which dev command to run.

The build ships the online shell, identity and storage on every
channel. Only preview output adds the standalone shell. The same
distribution check catches worker chunks from retained deploys.
The existing standalone tests and local preview tools opt in.
The preparation recorder still uses a local preview build until
its author preview can start the same local world as STR10.

The Ring 1 preview, staging and dev builds completed. Only preview
emitted a serverWorker chunk. The two actual Node dev browser
tests passed. Sunscar Dunes entered offline from the preview
service worker and the offline proof returned green.

The Nine ring, cook-to-play, parity and scorecard preview harnesses
request the stamp explicitly. The carry test keeps the old online
shell and removes the old standalone shell, worker and runtime.
