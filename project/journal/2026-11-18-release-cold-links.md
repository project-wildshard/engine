# Qualify cold links before go-live

> Written by: Codex

> **State:** implemented, 2026-11-18.

A Zone select tap and a fresh chunk URL start through different boot
paths. Staging verification runs both and keeps separate receipts. The
release gate requires both on the exact build. A failed cold Pine Hollow
link holds go-live even when every card and journey has passed.
