# Qualify the canonical quadruped's motion

> Written by: Codex
> State: verified locally, 2026-11-17.

The exported clipless GLB passes the real skin loader, creature factory
and Animal view. At 1.3 m/s the four knees reach their swing peaks a
quarter cycle apart. At 4 m/s diagonal knees pair. At 6 m/s the hind and
fore knees peak in two pairs, with a left-right lead. The head lowers
during graze and lifts on idle. The view samples a single raised foot
at 10 Hz and flexes its knee by 0.465 radians. The level-ground control
skips queries and the knee returns to its original angle. The authored
walk track still wins for its joint while untracked joints keep moving.

The eight-file local suite passed 34 cases, covering actual Kit views,
native rig rotation, cadence and retained physics, and Pine's pose
loading, king room and night emits. All 1,245 installed Pine product
files (336,257,046 bytes) match their admitted SHA-256 manifest. The
revision 5 pin is `2afc6270c9534acc9d6578686bf87479c63872ac58799cef416d13b3b8b0281b`.
The pin files match the earlier M2 land at `66de8027ad`.
