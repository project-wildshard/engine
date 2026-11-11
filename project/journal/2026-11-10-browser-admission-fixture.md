# Browser admission fixtures under load

Release queue job 341 ran 6,558 passing cases and failed the saturated
browser admission fixture. Its one-second refusal returned the expected
status and holder IDs, but the test process measured 5.536 seconds
against the existing five-second assertion. The original focused case
passed in 2.671 seconds.

The fixture repeatedly started Python to print two fixed holder rows
and to answer the empty process and simulator queries. Shell builtins
now return the same bytes and exit statuses. The real browser admission
script, the one-second wait, the five-second assertion and the
child-not-started and kernel-lock checks are unchanged.

The 10 direct fixture cases passed in 8.835 seconds. The J206 read-only
review found no required or suggested change.
