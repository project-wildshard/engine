# Accept socket errors in the disconnect fixture

The Postgres fixture stops its local server mid-transaction. The
driver can surface ECONNRESET or EPIPE as the connection closes.
Accept both and keep the assertion that the pool reconnects.
