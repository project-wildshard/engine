# Keep the MMO bot target exact

The v0.1.54 PostgreSQL replica booted on the box, then its bots refused
the URL because the driver appended the agent query. The guard accepts
exact staging and replica targets. The bot already marks its handshake
with both the agent header and user agent, so the driver passes the URL
verbatim. The allowlist still refuses queries for those targets.
