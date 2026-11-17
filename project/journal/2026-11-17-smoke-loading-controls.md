# Wait for the recovery control to be usable

The native retained35 WebKit profile laid out its Pause button while the
loading card still covered it. The proof chose Pause from visibility alone;
loading then ended on the title, so its stale Pause tap timed out.

Choose the first real hit target among recovery controls and recheck after
each transition or recovery capture. Use actual Dismiss, Back, Pause and Exit
taps. Keep page-error collection and every hard smoke check unchanged.

The real-browser regression fails red against the old helper: loading covers
Pause, then removes that HUD in favor of the title. The new helper must wait
for usable title controls instead of trying the obsolete Pause. The browser
case allows broker queue time; the app readiness deadline remains90 seconds.
