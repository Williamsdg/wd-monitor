#!/usr/bin/env bash
# One-time: publish wd-monitor to GitHub, turn on Pages, and start the 15-minute cron.
set -euo pipefail
cd "$(dirname "$0")"
gh repo create Williamsdg/wd-monitor --public --source=. --push --description "Williams Digital site health monitor (Jarvis)"
gh api -X POST repos/Williamsdg/wd-monitor/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/' >/dev/null
gh workflow run check.yml
echo
echo "Done. Dashboard will be at https://williamsdigital.io/wd-monitor/ in about two minutes."
echo "First cron run is queued; after that it runs every 15 minutes."
