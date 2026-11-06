# wd-monitor

Uptime, performance and expiry monitoring for Williams Digital's sites, with a Jarvis voice agent on top.

- **Every 15 minutes** (`check.mjs`, GitHub Actions): fetch each site, render it in headless Chrome to catch blank pages, fetch its critical paths, read certificate and domain expiry, retry before declaring down, write `data/`, open or close incidents, ask Claude for a diagnosis on each new outage, and push an alert (ntfy / email) on every down or recovery.
- **Nightly** (`vitals.mjs`): Lighthouse performance score per site into `data/vitals.json`.
- **Monthly** (`report.mjs`): one client report per site in `data/reports/<month>/`, drafts for Dylan to forward.
- **Dashboard** `index.html` (passphrase-gated), **public status pages** `status/?s=<slug>`, **MCP server** `mcp/server.mjs` for Claude Code, **Jarvis** (ElevenLabs) configured from `jarvis-prompt.md`.

```
npm test            # pure logic in lib/ (node:test)
node check.mjs      # one full round, locally
node report.mjs 2026-10
node set-passphrase.mjs "new phrase"
```

Secrets the workflows read: `NTFY_TOPIC`, `RESEND_API_KEY`, `ALERT_TO`, `REPORT_TO`, `ANTHROPIC_API_KEY`, `DEPLOY_HOOKS` (see `setup-secrets.sh`).
