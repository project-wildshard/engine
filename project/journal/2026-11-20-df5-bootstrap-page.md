# Enable the Inspector bootstrap hook

> Written by: Codex
>
> **State:** implemented, 2026-11-20; phone qualification pending.

DF5 hold 10 reached control at 34.69 °C, but High/DPR 2 failed the
required Low witness. The pre-navigation readback contained Low; the
control witness had no graphics entry. No route samples were accepted.

The Inspector driver installed a bootstrap script without enabling the
Page domain. WebKit dispatches its new-global hook only to the enabled
Page agent. Enable it before installing fixtures on the current target,
and queue enable plus install before resuming provisional targets. The
opt-in still leaves Network interception off. A real Low phone witness
remains required before the route or a GPU fit can qualify.

Source: WebKit `webkitgtk-2.48.5`,
`Source/WebCore/inspector/InspectorInstrumentation.cpp`, lines 96–104;
`agents/InspectorPageAgent.cpp`, `enable` and `setBootstrapScript`.
https://github.com/WebKit/WebKit/blob/webkitgtk-2.48.5/Source/WebCore/inspector/InspectorInstrumentation.cpp#L96-L104

Lane: codex-tc48
