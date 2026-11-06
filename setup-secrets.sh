#!/usr/bin/env bash
# One-time: puts the alerting / Claude secrets on the wd-monitor repo. Run it yourself (Claude Code is not allowed to write secrets).
#   bash ~/wd-monitor/setup-secrets.sh
set -euo pipefail
REPO=Williamsdg/wd-monitor

# 1. Push alerts (free). Subscribe to this exact topic in the ntfy app (iOS/Android) to get a push when a site goes down or recovers.
NTFY_TOPIC="wd-jarvis-QzC8v1yTOAyj"
gh secret set NTFY_TOPIC -R "$REPO" --body "$NTFY_TOPIC"
curl -s -o /dev/null -H "Title: Jarvis alerts connected" -H "Tags: white_check_mark" -H "Click: https://williamsdigital.io/wd-monitor/" \
  -d "Subscribe to this topic in the ntfy app: $NTFY_TOPIC. You'll get a push the moment a site goes down or comes back." "https://ntfy.sh/$NTFY_TOPIC"
echo "ntfy topic: $NTFY_TOPIC  (subscribe to it in the ntfy app)"

# 2. Email alerts + monthly report drafts, via the Williams Digital Resend key already in ~/.config/wd.
set -a; . ~/.config/wd/williamsdigital-resend.env; set +a
gh secret set RESEND_API_KEY -R "$REPO" --body "$RESEND_API_KEY"
gh secret set ALERT_TO  -R "$REPO" --body "dylan@williamsdigital.io"   # change if you'd rather be alerted elsewhere
gh secret set REPORT_TO -R "$REPO" --body "dylan@williamsdigital.io"   # monthly client report DRAFTS land here, never at the client

# 3. Claude: diagnoses every outage and writes the report narrative. Key from https://platform.claude.com/settings/keys
read -r -p "Anthropic API key (sk-ant-..., blank to skip): " ANTHROPIC_API_KEY
[ -n "${ANTHROPIC_API_KEY:-}" ] && gh secret set ANTHROPIC_API_KEY -R "$REPO" --body "$ANTHROPIC_API_KEY"

# 4. Optional: deploy hooks so "Jarvis, redeploy vardar" works. JSON of slug -> Vercel/Netlify deploy hook URL, e.g.
#    {"vardar":"https://api.vercel.com/v1/integrations/deploy/prj_xxx/yyy","simpatico":"https://api.vercel.com/..."}
read -r -p "DEPLOY_HOOKS JSON (blank to skip): " DEPLOY_HOOKS
[ -n "${DEPLOY_HOOKS:-}" ] && gh secret set DEPLOY_HOOKS -R "$REPO" --body "$DEPLOY_HOOKS"

gh secret list -R "$REPO"
echo "Done. The next check run picks these up."
