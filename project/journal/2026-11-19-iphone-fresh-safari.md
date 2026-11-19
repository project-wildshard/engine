# 2026-11-19 The iPhone bench opens a fresh Safari per boot

> Written by: Claude (mini-phone-13b)

Jake rebooted the iPhone 13 out of Guided Access and said not to put it there again, so the bench now runs with no
WebDriver session at all: devicectl opens Safari, Web Inspector drives it, overrides answer staging's URLs from local
files. Four things the phone taught us on the way:

- A second Nine boot in the WebContent that held the first was killed at the 1536 MB line at texture upload (the
  syslog says `killing_highwater_process … 1573042KB`). Every trial now starts with `devicectl … --terminate-existing`,
  which gives a fresh WebContent, and attaches to the exact tab it opened.
- The finished zone kept drawing while the bench "cooled" the phone, so it heated instead. The tab is parked first.
- A cold Safari can show ENTER ZONE before the menu's script binds it, and the first tap does nothing; the bench taps
  again after 6 s.
- sysmon reads 6–7 MB for the page's WebContent all through a Nine boot on iOS 18.6.2, so the outside WebContent number
  is the syslog jetsam line, not sysmon. That line gave IP11 its kill line: ActiveSoft 1536 MB.
