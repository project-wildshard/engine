# 2026-11-19: the staging mark goes back under Settings

Lane: buddy-engine (Coordinator P2, K6 staging sweep of v0.1.48).

44e9ecfea (TR-4) moved the STAGING mark from 36 px to 92 px because, at 36 px, it sat exactly
on the top of the phone HUD's status column (`--ws-top + 30`), where Brasscap's lever-action
magazine is a tappable reload. That cleared T1, but in every cell the mark then hung below the
coin counter, away from where SB10 put it (top left, under Settings).

The mark is back at 36 px, and on a page that shows it (staging only) the left column makes room:
the status column and the coin counter move down 22 px (the mark is 18 px, plus the column's
4 px gap), keeping their own spacing. A page without the mark lays out exactly as before. T1's
`staging mark covers no phone control` mounts the whole link CSS, so it judges these rules too.
