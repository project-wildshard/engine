# Bind preview ports at listener startup

HOW-WE-BUILD DS20a removes the probe/close/bind gap from shot hosts.
The maintained preview server binds port zero and reports its actual
port through its owning child's IPC connection. The shot helper uses
that authenticated child PID/port, then checks HTTP readiness; abort
and parent disconnect close the owned server. Ordinary CLI output is
unchanged.

`serve-build.sh --port 0` now obtains its port from the bound preview
listener. No named port allocation or port-lock file is used in this
mode. Existing server ownership records still support admission,
stop and reap: a pending builder identity becomes the actual bound
port only after startup. Existing named-port selection and guards
remain unchanged. A conflicting ownership record causes only the
new owned child to stop and retry; no foreign listener is stopped.

An explicit port-zero HEAD preview is independent of the shared
fixed-port preview. Its source SHA remains pinned through mirror
admission, including when main moves while it waits. Pending server
metadata is removed after a build failure.

The chaos proxy also accepts the standard `--port 0` or `--port=0`
alias. It refuses a conflicting fixed-port option rather than
silently overriding it. Existing upstream and token guards remain.

Native controls fail first: shot children requested preselected
ports, serve-build rejected zero, and the proxy rejected its alias.
The repaired pair returns distinct real listeners; all existing
lease/stop partitions and eight preview/abort controls pass. All 17
explicit native proxy controls pass. Strict lint/types pass. Hosted
qualification and the assigned batch's single landing remain open.
No CPU broker file, browser capacity rule or game protocol changes.
