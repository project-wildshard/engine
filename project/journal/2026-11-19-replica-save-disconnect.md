# A dropped Postgres transaction stays in the save queue

E7.4b.c's scratch Postgres restart on signed staging v0.1.52 killed
the replica while a checkpoint was in flight. The driver's checked-out
client emitted a socket error without a listener. The server exited
while the save queue also saw the failed query.

Listen for socket failure through the transaction and discard a dead
client. Preserve the original transaction error so the save queue can
retry. A failing rollback also retires its client. The TCP regression
closes the connection during the transaction and opens the next
transaction on a fresh connection.
