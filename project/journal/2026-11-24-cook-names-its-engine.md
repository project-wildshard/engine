> Written by: Claude (opus-pr6)

# 2026-11-24: the cook names its engine on the feed and in every verdict (QA-11-23-b row 46, J505)

Driftwood's republish of the same bytes got v0.1.79's refusal back after staging's cook moved on. api-server `5eb6322`
reopens a refusal made at an older channel format, but an engine bump inside one format went unseen: the cook's verdict
carried no engine.

Now `uploadDelivery` sends its build (`WILDSHARD_BUILD`) as `engine` on every pending-feed page (`?engine=<build>`,
signed with the cursor) and in every verdict, refused or cooked. api-server records the feed's engine as the channel's
current cook engine and the verdict's beside `refused_format`; a re-upload of bytes an older engine refused gets a
fresh cook, and a refusal by the current engine stays. The deployed API ignores both fields until that lands, so this
ships in any order. Tests: `test/cook-upload-transport.test.ts` (row 46 cases).
