# 2026-11-19: the loading card loses its Settings button

Lane: buddy-engine (QA-FEEDBACK-2026-11-19 row 51).

Jake, 16:09 Cancún: "Get rid of the settings button on the loading screen." Then at 16:10: "Make the exit to title
button not full width ... leave it at the half width."

The QA 30 row under the loading card had SETTINGS and EXIT TO TITLE side by side, each `flex: 1 1 0`. SETTINGS is gone,
along with its string (`s_loading_settings`, used nowhere else). Exit keeps the slot it had: the row is now
`justify-content: flex-end`, and the button's basis is half the row less half the gap. At 402 px in WebKit the row is
370 px wide and Exit is 180 px, starting at x = 206, which is where it sat beside Settings. HOLD AT LOADING SCREEN is
unchanged. The slow-load card's Retry and Exit row is a separate row and is untouched.

Boot Settings is still reachable from the title; nothing else imported it through the loading card.
