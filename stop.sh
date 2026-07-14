#!/bin/bash

cd "$(dirname "$0")"

if [ -f logs/inbox_cron.pid ]; then
  kill "$(cat logs/inbox_cron.pid)" 2>/dev/null || true
  rm logs/inbox_cron.pid
  echo "Inbox cron stopped"
fi

if [ -f logs/server.pid ]; then
  kill "$(cat logs/server.pid)" 2>/dev/null || true
  rm logs/server.pid
  echo "Server stopped"
fi

if [ -f logs/tunnel.pid ]; then
  kill "$(cat logs/tunnel.pid)" 2>/dev/null || true
  rm logs/tunnel.pid
  echo "Tunnel stopped"
fi
