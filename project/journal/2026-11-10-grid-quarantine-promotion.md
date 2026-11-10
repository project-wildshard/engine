# FL18: restore qualified grid coverage

Remove only test/standalone-grid.test.ts from quarantine.
All six original real-clock cases and their source-body blob remain unchanged.
The source-body Git blob is 16ca76ee2d53d4cd14d987db10dcfacd26333173.
The collision-only worker baker is public in d93898d.
Its plain collider bytes and all twenty-one default bake outputs retain exact identities.

The complete-prefix ledger verifies 12 consecutive actual accepted executions.
Each result has six passes, zero failed/skipped cases and one complete module clock.
Every module clock stays inside the original60000ms budget.
Observed clocks span36.032–46.095seconds.
Original ZIP hashes, matching run/SHA clocks and native-placement ancestry are verified.
The same test-body Git blob is present in every accepted source.
A blocking planner failure elsewhere does not erase an independently green file.
No-execution run42727391232 stays neutral.
The last actual overrun42723218515 remains recorded at70318.087ms.

Actual main CI push/fresh-dispatch receipts:
- 42723575585 d93898d409490e6e5c957395a57de6e61fd0ad13 36031.586ms
- 42724054664 d93898d409490e6e5c957395a57de6e61fd0ad13 38550.710ms
- 42724940225 d93898d409490e6e5c957395a57de6e61fd0ad13 45217.335ms
- 42725718914 d93898d409490e6e5c957395a57de6e61fd0ad13 44897.853ms
- 42726916674 d93898d409490e6e5c957395a57de6e61fd0ad13 44761.120ms
- 42727676374 55b2c74d4fdb7dc21e2395cf2a5fbb121647f1a8 44655.862ms
- 42728436660 55b2c74d4fdb7dc21e2395cf2a5fbb121647f1a8 37386.245ms
- 42728525906 7c1e029abbfc6859fc2ccb7130e2d75e66885993 43717.386ms
- 42729800034 7c1e029abbfc6859fc2ccb7130e2d75e66885993 44610.589ms
- 42730613947 7c1e029abbfc6859fc2ccb7130e2d75e66885993 41344.170ms
- 42730719038 a43491ad39ea98020011a91992c7a23fb67c44a8 37924.475ms
- 42731566359 dd3624f012f798d07a0fb995e60b77106d6648b6 46095.400ms

The later17:30 coordinator instruction requires ten complete CI executions per file.
It supersedes the historical dual-workflow count; no release attempt is rerun.
Ring1 is audited separately and keeps this file on the original explicit Ring2 list.
Full CI discovers it once in its existing singleton native group standalone-grid.
No group, duration, limit, file budget, real clock, route or assertion changes.
The post-removal full inventory is1186; it still has the pre-existing planner NoN.
Exact dd3624f reproduces that NoN before this removal at1185files.
Ring1 stays1103files,9shards,max227.242seconds, with its original Ring2 omission.
The planner/weight owner is codex-mock; no global engine hold is requested (J216).

All eight remaining policy records retain their exact values.
No owner, addedAt, original deadline or extension changes.
J20006:00UTC wake process90531 stays alive.
This supported policy commit is handed to j189 for normal queued publication.
Full hosted green is required before changing FL18Progress; it remains8of19 now.
Raw evidence is in meta ENGINE-FLAKY-GRID-PROMOTION.json and the file ledger.
