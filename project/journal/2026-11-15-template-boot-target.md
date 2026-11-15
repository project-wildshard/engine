# Template boot measurement targets

The timing probe now accepts loopback and staging origins. Production play
is outside this lane's proof scope. A served run still checks its exact
build id before opening a browser.

Metal measurements now verify the reported WebGL renderer, rather than
assuming a launch flag selected the GPU. The phone-tier proof explicitly
keeps the 30 fps cap. Three fresh selection-path runs use the existing
production-byte build and the normal title, shard selection and Enter.

Hosted Linux measurements remain separate from these Mac Metal samples.

The optional-module comparison suppresses only dynamically appended
modulepreload links in its baseline context. With those links suppressed,
the two selected startup modules enter the native module graph 90 ms
after their first attempted preloads. With them enabled, both requests
start in the same millisecond as their preload. The same compiler graph
has 22 files; 19 JS links already exist and two are added and reused.

These traces establish removal of the late native import wave. Overall
loader times were 1.975 s without and 1.991 s with links, so they do not
establish a wall-time speedup. The probe prints exact append and resource
times so that distinction remains reviewable.
