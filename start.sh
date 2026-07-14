#!/bin/bash
set -e

cd "$(dirname "$0")"
mkdir -p logs

# Start the Express server
nohup node server.js > logs/server.log &
echo $! > logs/server.pid

echo "Server started (PID: $(cat logs/server.pid)), logs: logs/server.log"

# Start the Airbnb inbox checker loop (every 2 minutes)
if [ -f airbnb_getter/venv/bin/python ]; then
  nohup airbnb_getter/venv/bin/python airbnb_getter/run_inbox_cron.py --loop > logs/inbox_cron.log &
  echo $! > logs/inbox_cron.pid
  echo "Airbnb inbox cron started (PID: $(cat logs/inbox_cron.pid)), logs: logs/inbox_cron.log"
fi

# Start the Cloudflare Tunnel
nohup bin/cloudflared tunnel --config cloudflared-config.yml run > logs/tunnel.log &
echo $! > logs/tunnel.pid

echo "Tunnel started (PID: $(cat logs/tunnel.pid)), logs: logs/tunnel.log"
echo "Public URL: https://api.luxstudios.shop"
