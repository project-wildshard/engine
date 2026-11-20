# Driftwood desktop draw checks

DF14's native Chromium trace on staging v0.1.55 charged 80–163 ms of
three long dock frames to synchronous framebuffer-status calls. The
calls happen after the scene draw, outside the frame meter's render
bucket. Two other long frames contained synchronous Canvas2D reads.
A trial using pixel-pack buffers and fences still blocked Chromium's
renderer thread in the polling timers.

The desktop experiment `debug.worldWatchDrawCheck=true` gives the
existing world watch responsibility for its canvas. Its scoped handoff
removes the two synchronous draw checks while the watch is active. The
watch still restores a hidden canvas, reports a transparent or black
view and offers reload if it persists. It first looks three seconds
after control. The experiment is off by default. The test exercises
canvas identity and restores the original check when the scope exits.
