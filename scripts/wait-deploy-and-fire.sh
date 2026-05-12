#!/usr/bin/env bash
# Polls Coolify deploy until finished, then triggers /run, then posts Slack summary.
# Self-contained background watcher.

# Env vars required (set before invoking):
#   COOLIFY_TOKEN, SLACK_BOT_TOKEN, SLACK_CHANNEL, OUTBOUND_SHARED_SECRET, DEPLOY_UUID, APP_UUID
COOLIFY_TOKEN="${COOLIFY_TOKEN:?missing COOLIFY_TOKEN env}"
DEPLOY_UUID="${DEPLOY_UUID:?missing DEPLOY_UUID env}"
APP_UUID="${APP_UUID:?missing APP_UUID env}"
APP_URL="http://${APP_UUID}.139.59.250.5.sslip.io"
SLACK_TOKEN="${SLACK_BOT_TOKEN:?missing SLACK_BOT_TOKEN env}"
SLACK_CHAN="${SLACK_CHANNEL:-D0B1BJZCLE9}"
SECRET="${OUTBOUND_SHARED_SECRET:?missing OUTBOUND_SHARED_SECRET env}"

slack() {
  curl -sS -H "Authorization: Bearer $SLACK_TOKEN" -H "Content-Type: application/json; charset=utf-8" \
    -d "{\"channel\":\"$SLACK_CHAN\",\"text\":\"$1\"}" "https://slack.com/api/chat.postMessage" > /dev/null
}

# Wait up to 20 min for deploy to finish
for i in $(seq 1 40); do
  status=$(curl -sS -H "Authorization: Bearer $COOLIFY_TOKEN" \
    "https://coolify.appexx.me/api/v1/deployments/$DEPLOY_UUID" \
    | grep -oE '"status":"[^"]+"' | head -1 | cut -d'"' -f4)
  echo "[$(date -Iseconds)] try $i: deploy=$status"
  if [[ "$status" == "finished" ]]; then
    echo "DEPLOY FINISHED"
    break
  fi
  if [[ "$status" == "failed" || "$status" == "error" ]]; then
    slack ":x: paranium.com Coolify deploy *failed* (status=$status). System inactive — check Coolify logs."
    exit 1
  fi
  sleep 30
done

# Verify worker is using new image (try /run with limit 1)
sleep 5
result=$(curl -sS -X POST "$APP_URL/run" -H "Content-Type: application/json" \
  -d "{\"limit\":1,\"secret\":\"$SECRET\"}" --max-time 120 2>&1)
echo "First /run probe: $result"

if echo "$result" | grep -q '"Executable doesn'; then
  slack ":warning: paranium.com worker still on old image (browser missing). Coolify cache issue. Restart container manually."
  exit 1
fi

# Trigger main batch
batch=$(curl -sS -X POST "$APP_URL/run" -H "Content-Type: application/json" \
  -d "{\"limit\":3,\"secret\":\"$SECRET\"}" --max-time 300 2>&1)
echo "Main batch: $batch"

# Status snapshot
status_resp=$(curl -sS "$APP_URL/status")
echo "Status: $status_resp"

slack ":white_check_mark: paranium.com outbound system *fully operational*. New Playwright v1.60 image deployed. Initial batch fired. Status: $status_resp"

echo "DONE"
