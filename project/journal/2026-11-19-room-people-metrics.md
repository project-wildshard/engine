# Daily counts of people and sessions

METRICS MT10 counts the room's daily and seven-day distinct players using
its existing keyed identities. Retention uses the first day seen and the
exact day the player returned. The date on a D7 row is the return date,
so its cohort first arrived seven days earlier. Session averages use
sessions that started that day and have ended.

The 40-day Postgres fixture includes an existing account in two sources,
a duplicate session, a first visit outside the measured cohort, a
production seat, and a marked staging agent. Only aggregate totals
leave the room.
