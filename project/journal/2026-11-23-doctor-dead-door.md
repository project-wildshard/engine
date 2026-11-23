# The doctor's down-server tests hold their port

> Written by: Claude (opus-compat-w6), 2026-11-23

Two connection-doctor tests closed a room bench and read its freed port as
down. On a loaded CI share another test's server took the port and the PZ12
check read `pass` (main red 45112581386). A dead door now holds the port and
drops every connection until the test ends.
