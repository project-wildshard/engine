# An absent desktop bundle is not native Safari readiness

The real LS1 Simulator attempt passed runtime-cache admission, device
boot and native migration, then failed before Safari launch. The selected
Xcode tools installation has its real CoreSimulator simctl launcher but
no Applications/Simulator.app. The wrapper tried to open that nonexistent
optional desktop presentation host and returned NSCocoa error 260.

Only request desktop presentation when that selected bundle exists.
Do not impersonate CI or skip a native prerequisite: runtime admission,
bootstatus, Safari launch and the owned two-frame callback remain mandatory,
with their original clocks and deadlines. An installed desktop host that
fails or times out still refuses and retires the owned device.

The manual sim-presentation-proof.py is outside hooks and test discovery.
Its two real Bash/HTTP fixture cases fail on old code, then pass in 2.902 s:
missing desktop plus no native frames refuses; missing desktop plus actual
fixture frames permits handover. Three existing CI/headless/presentation
failure cases pass in 5.050 s. Actual native LS1 reading remains pending;
these CLI fixtures do not claim a Simulator or plan-row pass.
